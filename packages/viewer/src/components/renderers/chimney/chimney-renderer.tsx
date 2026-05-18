import {
  type AnyNodeId,
  type ChimneyNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Brush, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import {
  csgEvaluator,
  csgGeometry,
  getRoofSegmentBrushes,
  prepareBrushForCSG,
} from '../../../systems/roof/roof-system'

// Single shared default material — the proper per-part material picker is
// the existing drag-and-drop system used for roofs / floors / etc.
const defaultMaterial = new MeshStandardNodeMaterial({
  roughness: 0.85,
  metalness: 0,
})

// Build a single slab (box) with planar UVs and write its triangles into the
// shared positions/uvs arrays. `halfWB/halfDB` = bottom half-extents,
// `halfWT/halfDT` = top half-extents (smaller = sloped sides).
function pushSlabFaces(
  positions: number[],
  uvs: number[],
  y0: number,
  y1: number,
  halfWB: number,
  halfDB: number,
  halfWT: number,
  halfDT: number,
  caps: { bottom?: boolean; top?: boolean } = {},
) {
  const includeBottom = caps.bottom !== false
  const includeTop = caps.top !== false
  const t = y1 - y0
  const bBL: [number, number, number] = [-halfWB, y0, -halfDB]
  const bBR: [number, number, number] = [halfWB, y0, -halfDB]
  const bTR: [number, number, number] = [halfWB, y0, halfDB]
  const bTL: [number, number, number] = [-halfWB, y0, halfDB]
  const tBL: [number, number, number] = [-halfWT, y1, -halfDT]
  const tBR: [number, number, number] = [halfWT, y1, -halfDT]
  const tTR: [number, number, number] = [halfWT, y1, halfDT]
  const tTL: [number, number, number] = [-halfWT, y1, halfDT]

  // Quads are given in (a,b,c,d) loop order matching their "outside" view.
  // We emit triangles with REVERSED winding (a,c,b) + (a,d,c) so the face
  // normals point OUTWARD — required so three-bvh-csg correctly classifies
  // the chimney as a solid for subtraction.
  const pushQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
    ud: [number, number],
  ) => {
    positions.push(...a, ...c, ...b, ...a, ...d, ...c)
    uvs.push(...ua, ...uc, ...ub, ...ua, ...ud, ...uc)
  }

  // Bottom (-Y)
  if (includeBottom) {
    pushQuad(
      bBL,
      bTL,
      bTR,
      bBR,
      [-halfWB, -halfDB],
      [-halfWB, halfDB],
      [halfWB, halfDB],
      [halfWB, -halfDB],
    )
  }
  // Top (+Y)
  if (includeTop) {
    pushQuad(
      tBL,
      tBR,
      tTR,
      tTL,
      [-halfWT, -halfDT],
      [halfWT, -halfDT],
      [halfWT, halfDT],
      [-halfWT, halfDT],
    )
  }
  // -Z, +X, +Z, -X sides
  pushQuad(bBL, bBR, tBR, tBL, [-halfWB, 0], [halfWB, 0], [halfWT, t], [-halfWT, t])
  pushQuad(bBR, bTR, tTR, tBR, [-halfDB, 0], [halfDB, 0], [halfDT, t], [-halfDT, t])
  pushQuad(bTR, bTL, tTL, tTR, [halfWB, 0], [-halfWB, 0], [-halfWT, t], [halfWT, t])
  pushQuad(bTL, bBL, tBL, tTL, [halfDB, 0], [-halfDB, 0], [-halfDT, t], [halfDT, t])
}

// Cylinder/frustum equivalent of pushSlabFaces. Emits a closed cylindrical
// section from y0 (radius rB) to y1 (radius rT). Outward winding matches
// pushSlabFaces so the combined geometry is consistent for CSG.
function pushCylinderFaces(
  positions: number[],
  uvs: number[],
  y0: number,
  y1: number,
  rB: number,
  rT: number,
  segments = 24,
  caps: { bottom?: boolean; top?: boolean } = {},
) {
  const includeBottom = caps.bottom !== false
  const includeTop = caps.top !== false
  const t = y1 - y0
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0)
    const s0 = Math.sin(a0)
    const c1 = Math.cos(a1)
    const s1 = Math.sin(a1)
    const bL: [number, number, number] = [rB * c0, y0, rB * s0]
    const bR: [number, number, number] = [rB * c1, y0, rB * s1]
    const tL: [number, number, number] = [rT * c0, y1, rT * s0]
    const tR: [number, number, number] = [rT * c1, y1, rT * s1]
    // Reversed-winding triangulation to keep outward normals.
    positions.push(...bL, ...tR, ...bR)
    positions.push(...bL, ...tL, ...tR)
    const u0 = i / segments
    const u1 = (i + 1) / segments
    uvs.push(u0, 0, u1, t, u1, 0)
    uvs.push(u0, 0, u0, t, u1, t)
  }
  if (includeBottom) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2
      const a1 = ((i + 1) / segments) * Math.PI * 2
      const p0: [number, number, number] = [rB * Math.cos(a0), y0, rB * Math.sin(a0)]
      const p1: [number, number, number] = [rB * Math.cos(a1), y0, rB * Math.sin(a1)]
      // Center, p0, p1 — yields -Y normal (outward).
      positions.push(0, y0, 0, ...p0, ...p1)
      uvs.push(0, 0, 0, 0, 0, 0)
    }
  }
  if (includeTop) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2
      const a1 = ((i + 1) / segments) * Math.PI * 2
      const p0: [number, number, number] = [rT * Math.cos(a0), y1, rT * Math.sin(a0)]
      const p1: [number, number, number] = [rT * Math.cos(a1), y1, rT * Math.sin(a1)]
      // Center, p1, p0 — yields +Y normal (outward).
      positions.push(0, y1, 0, ...p1, ...p0)
      uvs.push(0, 0, 0, 0, 0, 0)
    }
  }
}

function buildCapGeometry(node: ChimneyNode, segment: RoofSegmentNode): THREE.BufferGeometry {
  const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
  const baseY = peakY + node.heightAboveRidge + 0.05 // matches buildVisibleChimneyBrush.topY
  const overhang = Math.max(0, node.capOverhang ?? 0.04)
  const t = node.capThickness ?? 0.08
  const halfWChimney = node.width / 2
  const halfDChimney = node.depth / 2
  const halfWB = halfWChimney + overhang
  const halfDB = halfDChimney + overhang

  const positions: number[] = []
  const uvs: number[] = []
  const shape = node.capShape ?? 'sloped'
  const isRound = (node.bodyShape ?? 'square') === 'round'
  // For a round body, both halfW and halfD collapse to the radius (= width / 2).
  const rBChimney = halfWChimney
  const rB = halfWB

  if (shape === 'flat') {
    if (isRound) {
      pushCylinderFaces(positions, uvs, 0, t, rB, rB)
    } else {
      pushSlabFaces(positions, uvs, 0, t, halfWB, halfDB, halfWB, halfDB)
    }
  } else if (shape === 'stepped') {
    const tiers = 3
    const tierT = t / tiers
    for (let i = 0; i < tiers; i++) {
      const f = i / tiers
      if (isRound) {
        const r = rB + (rBChimney - rB) * f
        pushCylinderFaces(positions, uvs, i * tierT, (i + 1) * tierT, r, r)
      } else {
        const hw = halfWB + (halfWChimney - halfWB) * f
        const hd = halfDB + (halfDChimney - halfDB) * f
        pushSlabFaces(positions, uvs, i * tierT, (i + 1) * tierT, hw, hd, hw, hd)
      }
    }
  } else {
    // 'sloped' (default): frustum — oversized bottom, chimney-sized top.
    if (isRound) {
      pushCylinderFaces(positions, uvs, 0, t, rB, rBChimney)
    } else {
      pushSlabFaces(positions, uvs, 0, t, halfWB, halfDB, halfWChimney, halfDChimney)
    }
  }

  let geo: THREE.BufferGeometry = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))

  // Punch hole(s) through the cap. When flues are present we punch one small
  // hole per flue (matching the flue's inner profile, at the flue's x); the
  // user perceives the body cavity ONLY through the flues. Without flues we
  // punch one wide hole sized by bodyHollowMargin.
  const flueCountForCap = Math.max(0, Math.min(4, node.flueCount ?? 0))
  const flueWallTForCap = Math.max(0, node.flueWallThickness ?? 0.02)
  const flueDiameterForCap = Math.max(0.02, node.flueDiameter ?? 0.22)
  const flueInnerForCap = flueDiameterForCap - 2 * flueWallTForCap
  const useFlueHoles =
    flueCountForCap > 0 && flueWallTForCap > 0 && flueInnerForCap > 0.02

  const hollowMargin = Math.max(0, node.bodyHollowMargin ?? 0.08)
  const cutterGeos: THREE.BufferGeometry[] = []
  if (useFlueHoles) {
    const xs = flueXPositions(
      flueCountForCap,
      node.width,
      flueDiameterForCap,
      node.flueSpacing ?? 1,
    )
    const flueShape: 'round' | 'square' = node.flueShape ?? 'round'
    for (const x of xs) {
      const cg: THREE.BufferGeometry =
        flueShape === 'round'
          ? new THREE.CylinderGeometry(
              flueInnerForCap / 2,
              flueInnerForCap / 2,
              t + 0.04,
              24,
              1,
              false,
            )
          : new THREE.BoxGeometry(flueInnerForCap, t + 0.04, flueInnerForCap)
      cg.translate(x, t / 2, 0)
      cutterGeos.push(cg)
    }
  } else if (hollowMargin > 0) {
    let cutterGeo: THREE.BufferGeometry | null = null
    if (isRound) {
      const rCav = node.width / 2 - hollowMargin
      if (rCav > 0.02) {
        cutterGeo = new THREE.CylinderGeometry(rCav, rCav, t + 0.04, 24, 1, false)
      }
    } else {
      const cw = node.width - 2 * hollowMargin
      const cd = node.depth - 2 * hollowMargin
      if (cw > 0.04 && cd > 0.04) {
        cutterGeo = new THREE.BoxGeometry(cw, t + 0.04, cd)
      }
    }
    if (cutterGeo) {
      cutterGeo.translate(0, t / 2, 0)
      cutterGeos.push(cutterGeo)
    }
  }

  for (const cutterGeo of cutterGeos) {
    {

      // Cap geometry from pushSlabFaces is non-indexed and missing normals.
      // mergeVertices yields a clean indexed geometry; then add normals.
      let indexedCap = mergeVertices(geo, 1e-4)
      if (!indexedCap.getAttribute('normal')) indexedCap.computeVertexNormals()
      const ic = indexedCap.getIndex()?.count ?? 0
      indexedCap.clearGroups()
      if (ic > 0) indexedCap.addGroup(0, ic, 0)
      ;(indexedCap as any).computeBoundsTree = computeBoundsTree
      ;(indexedCap as any).computeBoundsTree({ maxLeafSize: 10 })

      const cic = cutterGeo.getIndex()?.count ?? 0
      cutterGeo.clearGroups()
      if (cic > 0) cutterGeo.addGroup(0, cic, 0)
      ;(cutterGeo as any).computeBoundsTree = computeBoundsTree
      ;(cutterGeo as any).computeBoundsTree({ maxLeafSize: 10 })

      try {
        const capBrush = new Brush(indexedCap, visibleDummyMat as any)
        capBrush.updateMatrixWorld()
        const cutterBrush = new Brush(cutterGeo, visibleDummyMat as any)
        cutterBrush.updateMatrixWorld()
        const result = csgEvaluator.evaluate(capBrush, cutterBrush, SUBTRACTION) as Brush
        const resultGeo = csgGeometry(result).clone()
        const idx = resultGeo.getIndex()?.count ?? 0
        resultGeo.clearGroups()
        if (idx > 0) resultGeo.addGroup(0, idx, 0)
        else resultGeo.addGroup(0, resultGeo.getAttribute('position').count, 0)
        geo.dispose()
        indexedCap.dispose()
        cutterGeo.dispose()
        result.geometry.dispose()
        geo = resultGeo
      } catch (e) {
        console.error('Cap hole CSG failed:', e)
        indexedCap.dispose()
        cutterGeo.dispose()
      }
    }
  }

  if (Math.abs(node.rotation) > 1e-4) geo.rotateY(node.rotation)
  geo.translate(node.position[0], baseY, node.position[2])
  geo.computeVertexNormals()
  return geo
}

function buildFluesGeometry(
  node: ChimneyNode,
  segment: RoofSegmentNode,
): THREE.BufferGeometry | null {
  const count = Math.max(0, Math.min(4, node.flueCount ?? 0))
  if (count === 0) return null

  const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
  const chimneyTopY = peakY + node.heightAboveRidge + 0.05
  const capPresent = (node.cap ?? true) && (node.capShape ?? 'sloped') !== 'none'
  const capTopY = chimneyTopY + (capPresent ? (node.capThickness ?? 0.08) : 0)

  const d = Math.max(0.02, node.flueDiameter ?? 0.22)
  const h = Math.max(0.02, node.flueHeight ?? 0.3)

  const xs = flueXPositions(count, node.width, d, node.flueSpacing ?? 1)

  const wallT = Math.max(0, node.flueWallThickness ?? 0.02)
  const innerSize = d - 2 * wallT
  const hollow = wallT > 0 && innerSize > 0.02

  const parts: THREE.BufferGeometry[] = []
  for (const x of xs) {
    const outer =
      node.flueShape === 'square'
        ? new THREE.BoxGeometry(d, h, d)
        : new THREE.CylinderGeometry(d / 2, d / 2, h, 24, 1, false)
    let final: THREE.BufferGeometry = outer

    if (hollow) {
      // Full-height through-hole — the flue is a real pipe, open both ends.
      // The cap and body have matching narrow shafts directly below each flue
      // (carved in buildChimneyGeometry / buildCapGeometry), so the deep
      // view stays contained inside the flue footprint instead of opening up
      // around it.
      const inner =
        node.flueShape === 'square'
          ? new THREE.BoxGeometry(innerSize, h + 0.04, innerSize)
          : new THREE.CylinderGeometry(innerSize / 2, innerSize / 2, h + 0.04, 24, 1, false)

      // Collapse groups + bounds trees for CSG.
      const setupBrush = (g: THREE.BufferGeometry) => {
        const ic = g.getIndex()?.count ?? 0
        g.clearGroups()
        if (ic > 0) g.addGroup(0, ic, 0)
        ;(g as any).computeBoundsTree = computeBoundsTree
        ;(g as any).computeBoundsTree({ maxLeafSize: 10 })
      }
      setupBrush(outer)
      setupBrush(inner)

      try {
        const outerBrush = new Brush(outer, visibleDummyMat as any)
        outerBrush.updateMatrixWorld()
        const innerBrush = new Brush(inner, visibleDummyMat as any)
        innerBrush.updateMatrixWorld()
        const result = csgEvaluator.evaluate(outerBrush, innerBrush, SUBTRACTION) as Brush
        final = csgGeometry(result).clone()
        const ri = final.getIndex()?.count ?? 0
        final.clearGroups()
        if (ri > 0) final.addGroup(0, ri, 0)
        else final.addGroup(0, final.getAttribute('position').count, 0)
        outer.dispose()
        inner.dispose()
        result.geometry.dispose()
      } catch (e) {
        console.error('Flue hollow CSG failed:', e)
        inner.dispose()
        final = outer
      }
    }

    final.translate(x, capTopY + h / 2, 0)
    parts.push(final)
  }

  // mergeGeometries needs all parts to share attribute layout. Strip UVs from
  // the box (cylinder has uv too); to keep things simple, drop uvs entirely —
  // flue material has no texture.
  for (const p of parts) {
    p.deleteAttribute('uv')
    p.deleteAttribute('uv1')
  }

  const merged = mergeGeometries(parts, false) ?? parts[0]?.clone() ?? null
  for (const p of parts) p.dispose()
  if (!merged) return null

  if (Math.abs(node.rotation) > 1e-4) merged.rotateY(node.rotation)
  merged.translate(node.position[0], 0, node.position[2])
  merged.computeVertexNormals()
  return merged
}

function flueXPositions(
  count: number,
  chimneyWidth: number,
  flueDiameter: number,
  spacing = 1,
): number[] {
  const xs: number[] = []
  if (count <= 0) return xs
  const fullAvailable = Math.max(0, chimneyWidth - flueDiameter)
  const available = fullAvailable * Math.max(0, Math.min(1, spacing))
  if (count === 1) {
    xs.push(0)
    return xs
  }
  for (let i = 0; i < count; i++) {
    xs.push(-available / 2 + (i * available) / (count - 1))
  }
  return xs
}

const visibleDummyMat = new THREE.MeshBasicMaterial()

// Build a closed non-indexed BufferGeometry representing the chimney body in
// chimney-local space. The shape is either a uniform box, or a flared/stepped
// "shouldered" column with a wider section at the bottom (above the roof).
function buildChimneyBodyGeometry(
  node: ChimneyNode,
  baseY: number,
  topY: number,
): THREE.BufferGeometry {
  const w = node.width
  // For a round body, depth tracks width (circle); we still keep `d` as a
  // local for clarity in the few square-only branches below (cricket).
  const isRound = (node.bodyShape ?? 'square') === 'round'
  const d = isRound ? node.width : node.depth
  const style = node.shoulderStyle ?? 'none'
  const r = w / 2

  const positions: number[] = []
  const uvs: number[] = []

  // Cricket — water-shedding wedge against the chimney's up-slope face.
  // Cricket attaches to a flat face, so it's only meaningful on square bodies.
  // Skipped entirely for round bodies.
  const cricketStyle = isRound ? 'none' : (node.cricketStyle ?? 'none')
  if (cricketStyle !== 'none') {
    const cL = Math.max(0.1, node.cricketLength ?? 0.6)
    const cH = Math.max(0.05, node.cricketHeight ?? 0.4)
    const side = node.cricketSide ?? 'front'
    const slopeSign = side === 'back' ? -1 : 1
    const sZ = slopeSign * (d / 2)
    const sZ_far = sZ + slopeSign * cL
    const peakY = baseY + cH
    const v0: [number, number, number] = [-w / 2, baseY, sZ]
    const v1: [number, number, number] = [w / 2, baseY, sZ]
    const v2: [number, number, number] = [w / 2, baseY, sZ_far]
    const v3: [number, number, number] = [-w / 2, baseY, sZ_far]
    const v4: [number, number, number] = [-w / 2, peakY, sZ]
    const v5: [number, number, number] = [w / 2, peakY, sZ]
    const pushTri = (a: number[], b: number[], c: number[]) => {
      // Reverse winding when slopeSign is negative so the cricket geometry
      // (which is mirrored across z=0) keeps outward-facing normals.
      if (slopeSign > 0) positions.push(...a, ...b, ...c)
      else positions.push(...a, ...c, ...b)
      uvs.push(0, 0, 0, 0, 0, 0)
    }
    // Bottom (v0,v1,v2,v3) — hidden against roof (gets trimmed by CSG).
    pushTri(v0, v1, v2)
    pushTri(v0, v2, v3)
    // Sloped top (v3,v2,v5,v4) — the visible cricket "roof".
    pushTri(v3, v2, v5)
    pushTri(v3, v5, v4)
    // Chimney-side back face (v0,v4,v5,v1) — hidden against chimney body.
    pushTri(v0, v4, v5)
    pushTri(v0, v5, v1)
    // Left triangle end (v0,v3,v4).
    pushTri(v0, v3, v4)
    // Right triangle end (v1,v5,v2).
    pushTri(v1, v5, v2)
  }

  // Bands are built as a separate mesh (see buildChimneyBandsGeometry) so
  // they can carry their own material independent of the body.

  if (style === 'none') {
    if (isRound) {
      pushCylinderFaces(positions, uvs, baseY, topY, r, r)
    } else {
      pushSlabFaces(positions, uvs, baseY, topY, w / 2, d / 2, w / 2, d / 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    return geo
  }

  const ext = Math.max(0, node.shoulderExtent ?? 0.1)
  const sh = Math.max(0.05, Math.min(node.shoulderHeight ?? 0.5, topY - baseY - 0.05))

  // The "shoulder" sits from baseY to baseY+sh. Above sh up to topY: uniform.
  // Each section is emitted as a fully-closed slab (all 6 caps) so CSG sees
  // closed manifolds and produces clean subtraction results. To prevent the
  // shared horizontal face between stacked slabs from z-fighting under
  // DoubleSide, neighbouring slabs are nudged together by EPS so the caps
  // sit at slightly different depths.
  const EPS = 0.0005

  if (style === 'tapered') {
    if (isRound) {
      pushCylinderFaces(positions, uvs, baseY, baseY + sh + EPS, r + ext, r)
      pushCylinderFaces(positions, uvs, baseY + sh - EPS, topY, r, r)
    } else {
      pushSlabFaces(
        positions,
        uvs,
        baseY,
        baseY + sh + EPS,
        w / 2 + ext,
        d / 2 + ext,
        w / 2,
        d / 2,
      )
      pushSlabFaces(positions, uvs, baseY + sh - EPS, topY, w / 2, d / 2, w / 2, d / 2)
    }
  } else {
    // 'corbeled': stacked tiers + uniform column above.
    const tiers = 3
    const tierH = sh / tiers
    for (let i = 0; i < tiers; i++) {
      const f = i / tiers
      const yBot = baseY + i * tierH - (i === 0 ? 0 : EPS)
      const yTop = baseY + (i + 1) * tierH + EPS
      if (isRound) {
        const rr = r + ext * (1 - f)
        pushCylinderFaces(positions, uvs, yBot, yTop, rr, rr)
      } else {
        const hw = w / 2 + ext * (1 - f)
        const hd = d / 2 + ext * (1 - f)
        pushSlabFaces(positions, uvs, yBot, yTop, hw, hd, hw, hd)
      }
    }
    if (isRound) {
      pushCylinderFaces(positions, uvs, baseY + sh - EPS, topY, r, r)
    } else {
      pushSlabFaces(positions, uvs, baseY + sh - EPS, topY, w / 2, d / 2, w / 2, d / 2)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

function buildVisibleChimneyBrush(
  node: ChimneyNode,
  segment: RoofSegmentNode,
): { brush: Brush; geo: THREE.BufferGeometry } {
  const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
  const topY = peakY + node.heightAboveRidge + 0.05
  // Extend the brush 0.5 m below wall-top so the chimney's bottom cap is
  // reliably inside wallBrush (which we subtract). Otherwise an at-eave
  // chimney's bottom face would sit exactly on the wallBrush boundary and
  // remain visible through a wide roof cutout.
  const baseY = Math.max(0, segment.wallHeight - 0.5)

  const geo = buildChimneyBodyGeometry(node, baseY, topY)
  if (Math.abs(node.rotation) > 1e-4) geo.rotateY(node.rotation)
  geo.translate(node.position[0], 0, node.position[2])
  geo.computeVertexNormals()

  // Single material group, matches the chimney mesh's single material.
  const posCount = geo.getAttribute('position').count
  geo.clearGroups()
  geo.addGroup(0, posCount, 0)

  ;(geo as any).computeBoundsTree = computeBoundsTree
  ;(geo as any).computeBoundsTree({ maxLeafSize: 10 })

  const brush = new Brush(geo, visibleDummyMat as any)
  brush.updateMatrixWorld()
  return { brush, geo }
}

// Bands geometry — emitted as a separate solid so it can carry its own
// material independent of the body. Trimmed against the roof via the same
// CSG pass as the body.
function buildChimneyBandsGeometry(
  node: ChimneyNode,
  baseY: number,
  topY: number,
): THREE.BufferGeometry | null {
  const bandStyle = node.bandStyle ?? 'none'
  if (bandStyle === 'none') return null

  const w = node.width
  const isRound = (node.bodyShape ?? 'square') === 'round'
  const d = isRound ? node.width : node.depth
  const r = w / 2

  const positions: number[] = []
  const uvs: number[] = []

  const bandExt = Math.max(0, node.bandExtent ?? 0.04)
  const bandH = Math.max(0.02, node.bandHeight ?? 0.1)
  const bandOffset = Math.max(0, node.bandOffset ?? 0.4)
  const count = bandStyle === 'double' ? 2 : 1
  const gap = bandH * 0.6
  for (let i = 0; i < count; i++) {
    const bandTop = topY - bandOffset - i * (bandH + gap)
    const bandBot = bandTop - bandH
    if (bandBot <= baseY + 0.01) break
    if (isRound) {
      pushCylinderFaces(positions, uvs, bandBot, bandTop, r + bandExt, r + bandExt)
    } else {
      pushSlabFaces(
        positions,
        uvs,
        bandBot,
        bandTop,
        w / 2 + bandExt,
        d / 2 + bandExt,
        w / 2 + bandExt,
        d / 2 + bandExt,
      )
    }
  }

  if (positions.length === 0) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

function buildBandsBrush(
  node: ChimneyNode,
  segment: RoofSegmentNode,
): { brush: Brush; geo: THREE.BufferGeometry } | null {
  const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
  const topY = peakY + node.heightAboveRidge + 0.05
  const baseY = Math.max(0, segment.wallHeight - 0.5)

  const geo = buildChimneyBandsGeometry(node, baseY, topY)
  if (!geo) return null

  if (Math.abs(node.rotation) > 1e-4) geo.rotateY(node.rotation)
  geo.translate(node.position[0], 0, node.position[2])
  geo.computeVertexNormals()

  const posCount = geo.getAttribute('position').count
  geo.clearGroups()
  geo.addGroup(0, posCount, 0)
  ;(geo as any).computeBoundsTree = computeBoundsTree
  ;(geo as any).computeBoundsTree({ maxLeafSize: 10 })

  const brush = new Brush(geo, visibleDummyMat as any)
  brush.updateMatrixWorld()
  return { brush, geo }
}

// Build a vertical-shaft cutter at a chimney-local (x, z) position. Used both
// for the wide body cavity (no flues) and the narrow per-flue shafts.
function buildShaftCutter(
  node: ChimneyNode,
  yTop: number,
  yBot: number,
  localX: number,
  localZ: number,
  shape: 'round' | 'square',
  sizeX: number, // diameter for round, width along X for square
  sizeZ: number = sizeX, // depth along Z for square (ignored for round)
): Brush | null {
  const h = yTop - yBot
  if (h < 0.02 || sizeX < 0.02 || sizeZ < 0.02) return null
  const midY = (yTop + yBot) / 2

  const geo: THREE.BufferGeometry =
    shape === 'round'
      ? new THREE.CylinderGeometry(sizeX / 2, sizeX / 2, h, 24, 1, false)
      : new THREE.BoxGeometry(sizeX, h, sizeZ)

  geo.translate(localX, midY, localZ)
  if (Math.abs(node.rotation) > 1e-4) geo.rotateY(node.rotation)
  geo.translate(node.position[0], 0, node.position[2])

  const indexCount = geo.getIndex()?.count ?? 0
  geo.clearGroups()
  if (indexCount > 0) geo.addGroup(0, indexCount, 0)

  ;(geo as any).computeBoundsTree = computeBoundsTree
  ;(geo as any).computeBoundsTree({ maxLeafSize: 10 })

  const brush = new Brush(geo, visibleDummyMat as any)
  brush.updateMatrixWorld()
  return brush
}

// Build the cavity cutter(s) to subtract from the chimney body.
// • With flues: one narrow shaft per flue, sized to the flue's INNER diameter.
// • Without flues: a single wide cavity sized by bodyHollowMargin.
function buildBodyCavityCutters(node: ChimneyNode, topY: number): Brush[] {
  const depth = Math.max(0, node.bodyHollowDepth ?? 0.6)
  if (depth < 0.01) return []

  const yTop = topY + 0.01
  const yBot = topY - depth

  const flueCount = Math.max(0, Math.min(4, node.flueCount ?? 0))
  const flueWallT = Math.max(0, node.flueWallThickness ?? 0.02)
  const flueDiameter = Math.max(0.02, node.flueDiameter ?? 0.22)
  const flueInner = flueDiameter - 2 * flueWallT
  const cutters: Brush[] = []

  if (flueCount > 0 && flueWallT > 0 && flueInner > 0.02) {
    // One narrow shaft per flue, matching its inner profile.
    const xs = flueXPositions(flueCount, node.width, flueDiameter, node.flueSpacing ?? 1)
    const flueShape: 'round' | 'square' = node.flueShape ?? 'round'
    for (const x of xs) {
      const cutter = buildShaftCutter(node, yTop, yBot, x, 0, flueShape, flueInner)
      if (cutter) cutters.push(cutter)
    }
    return cutters
  }

  // No flues — wide body cavity (legacy behaviour).
  const margin = Math.max(0, node.bodyHollowMargin ?? 0.08)
  if (margin <= 0) return []
  const isRound = (node.bodyShape ?? 'square') === 'round'
  if (isRound) {
    const r = node.width / 2 - margin
    if (r > 0.02) {
      const c = buildShaftCutter(node, yTop, yBot, 0, 0, 'round', r * 2)
      if (c) cutters.push(c)
    }
  } else {
    const w = node.width - 2 * margin
    const d = node.depth - 2 * margin
    if (w > 0.04 && d > 0.04) {
      const c = buildShaftCutter(node, yTop, yBot, 0, 0, 'square', w, d)
      if (c) cutters.push(c)
    }
  }
  return cutters
}

// Build a panel cutter brush for one face of the chimney body. Each cutter is
// a small closed box positioned just inside one face — when CSG-subtracted
// from the body it leaves a rectangular recess (the inset panel).
function buildPanelCutterBrush(
  node: ChimneyNode,
  topY: number,
  face: 'frontZ' | 'backZ' | 'rightX' | 'leftX',
): Brush | null {
  const w = node.width
  const d = node.depth
  const margin = Math.max(0, node.panelMargin ?? 0.1)
  const depthRecess = Math.max(0.005, node.panelDepth ?? 0.03)
  const panelHeight = Math.max(0.05, node.panelHeight ?? 0.8)
  const offsetTop = Math.max(0, node.panelOffsetTop ?? 0.15)

  const yTop = topY - offsetTop
  const yBot = yTop - panelHeight
  const midY = (yTop + yBot) / 2
  const eps = 0.002 // small overlap with the face so CSG cuts cleanly

  let cx = 0
  let cz = 0
  let sx = 0
  let sz = 0
  const sy = panelHeight

  switch (face) {
    case 'frontZ':
      sx = Math.max(0.05, w - 2 * margin)
      sz = depthRecess + 2 * eps
      cz = d / 2 - depthRecess / 2 + eps
      break
    case 'backZ':
      sx = Math.max(0.05, w - 2 * margin)
      sz = depthRecess + 2 * eps
      cz = -d / 2 + depthRecess / 2 - eps
      break
    case 'rightX':
      sz = Math.max(0.05, d - 2 * margin)
      sx = depthRecess + 2 * eps
      cx = w / 2 - depthRecess / 2 + eps
      break
    case 'leftX':
      sz = Math.max(0.05, d - 2 * margin)
      sx = depthRecess + 2 * eps
      cx = -w / 2 + depthRecess / 2 - eps
      break
  }

  if (sx <= 0 || sz <= 0) return null

  const geo = new THREE.BoxGeometry(sx, sy, sz)
  geo.translate(cx, midY, cz)
  if (Math.abs(node.rotation) > 1e-4) geo.rotateY(node.rotation)
  geo.translate(node.position[0], 0, node.position[2])

  // Collapse to a single material group so CSG output stays single-group.
  const indexCount = geo.getIndex()?.count ?? 0
  geo.clearGroups()
  if (indexCount > 0) geo.addGroup(0, indexCount, 0)

  ;(geo as any).computeBoundsTree = computeBoundsTree
  ;(geo as any).computeBoundsTree({ maxLeafSize: 10 })

  const brush = new Brush(geo, visibleDummyMat as any)
  brush.updateMatrixWorld()
  return brush
}

function buildChimneyGeometry(
  node: ChimneyNode,
  segment: RoofSegmentNode,
): { body: THREE.BufferGeometry; bands: THREE.BufferGeometry | null } {
  // Fallback geometry — full upright box from wall-top to chimney top.
  const fallback = (): { body: THREE.BufferGeometry; bands: THREE.BufferGeometry | null } => {
    const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
    const topY = peakY + node.heightAboveRidge
    const baseY = segment.wallHeight
    const h = Math.max(0.05, topY - baseY)
    const geo = new THREE.BoxGeometry(node.width, h, node.depth)
    if (Math.abs(node.rotation) > 1e-4) geo.rotateY(node.rotation)
    geo.translate(node.position[0], (topY + baseY) / 2, node.position[2])
    return { body: geo, bands: null }
  }

  const { brush: chimneyBrush } = buildVisibleChimneyBrush(node, segment)
  const bandsPair = buildBandsBrush(node, segment)

  const segBrushes = getRoofSegmentBrushes(segment)
  if (!segBrushes) {
    chimneyBrush.geometry.dispose()
    if (bandsPair) bandsPair.brush.geometry.dispose()
    return fallback()
  }

  const { deckSlab, shinSlab, wallBrush, innerBrush, shinTopBrush } = segBrushes

  // Anchor for cutters that reference the chimney top.
  const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
  const topY = peakY + node.heightAboveRidge + 0.05

  // Optional inset panels — only meaningful for square bodies (round chimneys
  // have no flat face). Build one cutter per face; we'll CSG-subtract each.
  const panelCutters: Brush[] = []
  const wantPanels =
    (node.panelStyle ?? 'none') !== 'none' && (node.bodyShape ?? 'square') !== 'round'
  if (wantPanels) {
    for (const face of ['frontZ', 'backZ', 'rightX', 'leftX'] as const) {
      const cutter = buildPanelCutterBrush(node, topY, face)
      if (cutter) panelCutters.push(cutter)
    }
  }

  // Body cavity (smoke hole). When flues exist we carve one narrow shaft per
  // flue; otherwise a single wide cavity sized by bodyHollowMargin.
  const cavityCutters = buildBodyCavityCutters(node, topY)

  // Helper that runs the wall+shin trim on any brush, returning a clean
  // single-group BufferGeometry. Used for body and bands.
  const trimWithRoof = (brush: Brush): THREE.BufferGeometry => {
    const step1 = csgEvaluator.evaluate(brush, wallBrush, SUBTRACTION) as Brush
    prepareBrushForCSG(step1)
    const trimmed = csgEvaluator.evaluate(step1, shinTopBrush, SUBTRACTION) as Brush
    const out = csgGeometry(trimmed).clone()
    const ic = out.getIndex()?.count ?? 0
    out.clearGroups()
    if (ic > 0) out.addGroup(0, ic, 0)
    out.computeVertexNormals()
    step1.geometry.dispose()
    trimmed.geometry.dispose()
    return out
  }

  let bodyResult: THREE.BufferGeometry
  let bandsResult: THREE.BufferGeometry | null = null

  try {
    // ----- BODY -----
    // Subtract panel + cavity cutters from the chimney body, then trim
    // against the wall and shingle volumes.
    let current: Brush = chimneyBrush
    const intermediates: Brush[] = []
    const allCutters: Brush[] = []
    allCutters.push(...cavityCutters)
    allCutters.push(...panelCutters)
    for (const cutter of allCutters) {
      const next = csgEvaluator.evaluate(current, cutter, SUBTRACTION) as Brush
      prepareBrushForCSG(next)
      if (current !== chimneyBrush) intermediates.push(current)
      current = next
    }
    bodyResult = trimWithRoof(current)
    if (current !== chimneyBrush) intermediates.push(current)
    for (const b of intermediates) b.geometry.dispose()

    // ----- BANDS -----
    if (bandsPair) {
      try {
        bandsResult = trimWithRoof(bandsPair.brush)
      } catch (e) {
        console.error('Chimney bands trim CSG failed:', e)
        bandsResult = null
      }
    }

    return { body: bodyResult, bands: bandsResult }
  } catch (e) {
    console.error('Chimney trim CSG failed:', e)
    return fallback()
  } finally {
    chimneyBrush.geometry.dispose()
    if (bandsPair) bandsPair.brush.geometry.dispose()
    deckSlab.geometry.dispose()
    shinSlab.geometry.dispose()
    wallBrush.geometry.dispose()
    innerBrush.geometry.dispose()
    shinTopBrush.geometry.dispose()
    for (const cutter of panelCutters) cutter.geometry.dispose()
    for (const cutter of cavityCutters) cutter.geometry.dispose()
  }
}

export const ChimneyRenderer = ({ node: storeNode }: { node: ChimneyNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'chimney', ref)
  const handlers = useNodeEvents(storeNode, 'chimney')

  // Slider drags write into useLiveNodeOverrides for live preview without
  // touching the scene store (avoids dirtying the roof and triggering its
  // expensive rebuild on every drag tick). Commit clears the override.
  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as ChimneyNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(() => {
    if (!segment) return null
    return buildChimneyGeometry(node, segment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment?.position[0],
    segment?.position[1],
    segment?.position[2],
    segment?.rotation,
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    segment?.width,
    segment?.depth,
    segment?.wallThickness,
    segment?.deckThickness,
    segment?.overhang,
    segment?.shingleThickness,
    node.position[0],
    node.position[2],
    node.rotation,
    node.width,
    node.depth,
    node.heightAboveRidge,
    node.shoulderStyle,
    node.shoulderHeight,
    node.shoulderExtent,
    node.bandStyle,
    node.bandHeight,
    node.bandExtent,
    node.bandOffset,
    node.cricketStyle,
    node.cricketLength,
    node.cricketHeight,
    node.cricketSide,
    node.bodyShape,
    node.bodyHollowDepth,
    node.bodyHollowMargin,
    node.panelStyle,
    node.panelDepth,
    node.panelHeight,
    node.panelOffsetTop,
    node.panelMargin,
    node.flueCount,
    node.flueDiameter,
    node.flueWallThickness,
    node.flueSpacing,
    node.flueShape,
  ])

  const capGeometry = useMemo(() => {
    if (!segment) return null
    if (!(node.cap ?? true)) return null
    if ((node.capShape ?? 'sloped') === 'none') return null
    return buildCapGeometry(node, segment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    node.position[0],
    node.position[2],
    node.rotation,
    node.width,
    node.depth,
    node.heightAboveRidge,
    node.cap,
    node.capShape,
    node.capOverhang,
    node.capThickness,
    node.bodyShape,
    node.bodyHollowMargin,
    node.flueCount,
    node.flueDiameter,
    node.flueWallThickness,
    node.flueSpacing,
    node.flueShape,
  ])

  useEffect(() => {
    return () => {
      geometry?.body.dispose()
      geometry?.bands?.dispose()
    }
  }, [geometry])

  useEffect(() => {
    return () => {
      capGeometry?.dispose()
    }
  }, [capGeometry])

  const fluesGeometry = useMemo(() => {
    if (!segment) return null
    return buildFluesGeometry(node, segment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    node.position[0],
    node.position[2],
    node.rotation,
    node.width,
    node.heightAboveRidge,
    node.cap,
    node.capThickness,
    node.flueCount,
    node.flueShape,
    node.flueHeight,
    node.flueDiameter,
    node.flueSpacing,
    node.flueWallThickness,
  ])

  useEffect(() => {
    return () => {
      fluesGeometry?.dispose()
    }
  }, [fluesGeometry])

  // Resolve material from the drag-drop pipeline (node.materialPreset for
  // library refs, node.material for explicit overrides). Fall back to the
  // default white when nothing's applied.
  const presetMaterial = createMaterialFromPresetRef(node.materialPreset)
  const explicitMaterial = node.material ? createMaterial(node.material) : null
  const material = explicitMaterial ?? presetMaterial ?? defaultMaterial

  if (!segment || !geometry) return null

  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh castShadow geometry={geometry.body} material={material} receiveShadow />
      {geometry.bands && (
        <mesh castShadow geometry={geometry.bands} material={material} receiveShadow />
      )}
      {capGeometry && (
        <mesh castShadow geometry={capGeometry} material={material} receiveShadow />
      )}
      {fluesGeometry && (
        <mesh castShadow geometry={fluesGeometry} material={material} receiveShadow />
      )}
    </group>
  )
}
