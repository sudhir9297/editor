import type { RidgeVentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const ARC_SEGMENTS = 8
const SHELL_THICKNESS = 0.25
const SHINGLED_PEAK_SEGS = 3
const SHINGLED_TAB_SIZE = 0.3

export function buildRidgeVentGeometry(
  node: RidgeVentNode,
): THREE.BufferGeometry | null {
  const halfLen = node.length / 2
  const halfW = node.width / 2
  const h = node.height

  const geometries: THREE.BufferGeometry[] = []

  if (node.style === 'metal') {
    geometries.push(buildMetalProfile(halfLen, halfW, h))
  } else if (node.style === 'shingled') {
    geometries.push(buildShingledProfile(halfLen, halfW, h))
  } else {
    geometries.push(buildCurvedCapProfile(halfLen, halfW, h))
  }

  if (node.endCaps) {
    let capGeo: THREE.BufferGeometry | null
    if (node.style === 'metal') {
      capGeo = buildMetalEndCaps(halfLen, halfW, h)
    } else if (node.style === 'shingled') {
      capGeo = buildShingledEndCaps(halfLen, halfW, h)
    } else {
      capGeo = buildCurvedEndCaps(halfLen, halfW, h)
    }
    if (capGeo) geometries.push(capGeo)
  }

  const merged =
    geometries.length === 1
      ? geometries[0]!
      : mergeGeometries(geometries, false) ?? geometries[0]!

  return merged
}

// ---------------------------------------------------------------------------
// Standard / Shingled: a smooth curved cap shell with thickness
// Cross-section is an arc from left-eave down the slope, over the peak, and
// down to the right eave. The inner surface is offset inward by shell thickness.
// ---------------------------------------------------------------------------

function buildCurvedCapProfile(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const outerPts: [number, number][] = []
  const innerPts: [number, number][] = []

  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const frac = i / ARC_SEGMENTS // 0..1
    const angle = Math.PI * frac   // PI..0 — left to right

    const z = -halfW + frac * (2 * halfW)
    const y = h * Math.sin(angle)

    outerPts.push([z, y])

    // Inner surface: offset inward (toward the roof) by thickness
    // Normal direction at this point
    const nx = 0
    const dz = i < ARC_SEGMENTS ? (outerPts[i + 1]?.[0] ?? z + 0.01) - z : z - (outerPts[i - 1]?.[0] ?? z - 0.01)
    const dy = i < ARC_SEGMENTS ? (outerPts[i + 1]?.[1] ?? y) - y : y - (outerPts[i - 1]?.[1] ?? y)
    // Tangent is (dz, dy), normal pointing inward is (dy, -dz) normalized
    const len = Math.sqrt(dz * dz + dy * dy) || 1
    const nz = -dy / len
    const ny = dz / len
    // Offset inward
    innerPts.push([z - nz * t, y - ny * t])
  }

  // Recompute inner normals properly now that we have all outer points
  innerPts.length = 0
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const [z, y] = outerPts[i]!
    let dz: number, dy: number
    if (i === 0) {
      dz = outerPts[1]![0] - z
      dy = outerPts[1]![1] - y
    } else if (i === ARC_SEGMENTS) {
      dz = z - outerPts[i - 1]![0]
      dy = y - outerPts[i - 1]![1]
    } else {
      dz = outerPts[i + 1]![0] - outerPts[i - 1]![0]
      dy = outerPts[i + 1]![1] - outerPts[i - 1]![1]
    }
    const len = Math.sqrt(dz * dz + dy * dy) || 1
    // Inward-pointing normal: rotate tangent (dz, dy) by -90°
    const nz = dy / len
    const ny = -dz / len
    innerPts.push([z + nz * t, y + ny * t])
  }

  // Build quads between consecutive arc segments, for both front and back faces
  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const [oz0, oy0] = outerPts[i]!
    const [oz1, oy1] = outerPts[i + 1]!
    const [iz0, iy0] = innerPts[i]!
    const [iz1, iy1] = innerPts[i + 1]!

    // Compute face normal for outer surface
    const dz = oz1 - oz0
    const dy = oy1 - oy0
    const fLen = Math.sqrt(dz * dz + dy * dy) || 1
    const fnz = -dy / fLen
    const fny = dz / fLen

    // Outer surface (front and back along X)
    const oA = [-halfLen, oy0, oz0]
    const oB = [halfLen, oy0, oz0]
    const oC = [halfLen, oy1, oz1]
    const oD = [-halfLen, oy1, oz1]

    pushQuad(positions, normals, uvs, oA, oB, oC, oD, [0, fny, fnz])

    // Inner surface (reversed)
    const iA = [-halfLen, iy0, iz0]
    const iB = [halfLen, iy0, iz0]
    const iC = [halfLen, iy1, iz1]
    const iD = [-halfLen, iy1, iz1]

    pushQuad(positions, normals, uvs, iD, iC, iB, iA, [0, -fny, -fnz])
  }

  // Bottom edges: connect outer to inner at left and right eave
  // Left eave (i=0)
  {
    const [oz, oy] = outerPts[0]!
    const [iz, iy] = innerPts[0]!
    const a = [-halfLen, oy, oz]
    const b = [halfLen, oy, oz]
    const c = [halfLen, iy, iz]
    const d = [-halfLen, iy, iz]
    pushQuad(positions, normals, uvs, d, c, b, a, [0, -1, 0])
  }
  // Right eave (i=ARC_SEGMENTS)
  {
    const [oz, oy] = outerPts[ARC_SEGMENTS]!
    const [iz, iy] = innerPts[ARC_SEGMENTS]!
    const a = [-halfLen, oy, oz]
    const b = [halfLen, oy, oz]
    const c = [halfLen, iy, iz]
    const d = [-halfLen, iy, iz]
    pushQuad(positions, normals, uvs, a, b, c, d, [0, -1, 0])
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

// ---------------------------------------------------------------------------
// Curved end caps — fill the shell cross-section at each end
// ---------------------------------------------------------------------------
function buildCurvedEndCaps(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry | null {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const outerPts: [number, number][] = []
  const innerPts: [number, number][] = []

  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const frac = i / ARC_SEGMENTS
    const angle = Math.PI * frac
    const z = -halfW + frac * (2 * halfW)
    const y = h * Math.sin(angle)
    outerPts.push([z, y])
  }
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const [z, y] = outerPts[i]!
    let dz: number, dy: number
    if (i === 0) {
      dz = outerPts[1]![0] - z; dy = outerPts[1]![1] - y
    } else if (i === ARC_SEGMENTS) {
      dz = z - outerPts[i - 1]![0]; dy = y - outerPts[i - 1]![1]
    } else {
      dz = outerPts[i + 1]![0] - outerPts[i - 1]![0]
      dy = outerPts[i + 1]![1] - outerPts[i - 1]![1]
    }
    const len = Math.sqrt(dz * dz + dy * dy) || 1
    const nz = dy / len
    const ny = -dz / len
    innerPts.push([z + nz * t, y + ny * t])
  }

  for (const sign of [-1, 1]) {
    const x = sign * halfLen
    const nx = sign

    // Build quads between outer and inner arcs
    for (let i = 0; i < ARC_SEGMENTS; i++) {
      const [oz0, oy0] = outerPts[i]!
      const [oz1, oy1] = outerPts[i + 1]!
      const [iz0, iy0] = innerPts[i]!
      const [iz1, iy1] = innerPts[i + 1]!

      const a: [number, number, number] = [x, oy0, oz0]
      const b: [number, number, number] = [x, oy1, oz1]
      const c: [number, number, number] = [x, iy1, iz1]
      const d: [number, number, number] = [x, iy0, iz0]

      if (sign > 0) {
        pushQuadVec(positions, normals, uvs, a, b, c, d, [nx, 0, 0])
      } else {
        pushQuadVec(positions, normals, uvs, d, c, b, a, [nx, 0, 0])
      }
    }
  }

  if (positions.length === 0) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

// ---------------------------------------------------------------------------
// Shingled: angular slopes with rounded peak ridge and shingle tab divisions
// Cross-section is two flat slopes meeting at a small rounded peak, with
// visible tab divider ridges along the length.
// ---------------------------------------------------------------------------

function buildShingledProfile(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const peakR = halfW * 0.1
  const slopeY = h * (halfW - peakR) / halfW

  const outerPts: [number, number][] = [[-halfW, 0]]
  for (let i = 0; i <= SHINGLED_PEAK_SEGS; i++) {
    const frac = i / SHINGLED_PEAK_SEGS
    const angle = Math.PI * (1 - frac)
    outerPts.push([
      peakR * Math.cos(angle),
      slopeY + (h - slopeY) * Math.sin(angle),
    ])
  }
  outerPts.push([halfW, 0])

  const innerPts = offsetProfileInward(outerPts, t)

  for (let i = 0; i < outerPts.length - 1; i++) {
    const [oz0, oy0] = outerPts[i]!
    const [oz1, oy1] = outerPts[i + 1]!
    const [iz0, iy0] = innerPts[i]!
    const [iz1, iy1] = innerPts[i + 1]!

    const dz = oz1 - oz0
    const dy = oy1 - oy0
    const fLen = Math.sqrt(dz * dz + dy * dy) || 1
    const fnz = -dy / fLen
    const fny = dz / fLen

    pushQuad(positions, normals, uvs,
      [-halfLen, oy0, oz0], [halfLen, oy0, oz0],
      [halfLen, oy1, oz1], [-halfLen, oy1, oz1],
      [0, fny, fnz])

    pushQuad(positions, normals, uvs,
      [-halfLen, iy1, iz1], [halfLen, iy1, iz1],
      [halfLen, iy0, iz0], [-halfLen, iy0, iz0],
      [0, -fny, -fnz])
  }

  {
    const [oz, oy] = outerPts[0]!
    const [iz, iy] = innerPts[0]!
    pushQuad(positions, normals, uvs,
      [-halfLen, iy, iz], [halfLen, iy, iz],
      [halfLen, oy, oz], [-halfLen, oy, oz],
      [0, -1, 0])
  }
  {
    const last = outerPts.length - 1
    const [oz, oy] = outerPts[last]!
    const [iz, iy] = innerPts[last]!
    pushQuad(positions, normals, uvs,
      [-halfLen, oy, oz], [halfLen, oy, oz],
      [halfLen, iy, iz], [-halfLen, iy, iz],
      [0, -1, 0])
  }

  const totalLen = halfLen * 2
  const numTabs = Math.max(2, Math.round(totalLen / SHINGLED_TAB_SIZE))
  const tabLen = totalLen / numTabs
  const ridgeH = h * 0.06
  const ridgeD = 0.006

  for (let tab = 1; tab < numTabs; tab++) {
    const x = -halfLen + tab * tabLen

    for (let i = 0; i < outerPts.length - 1; i++) {
      const [oz0, oy0] = outerPts[i]!
      const [oz1, oy1] = outerPts[i + 1]!

      const dz = oz1 - oz0
      const dy = oy1 - oy0
      const fLen = Math.sqrt(dz * dz + dy * dy) || 1
      const fnz = -dy / fLen
      const fny = dz / fLen

      const r0y = oy0 + fny * ridgeH
      const r0z = oz0 + fnz * ridgeH
      const r1y = oy1 + fny * ridgeH
      const r1z = oz1 + fnz * ridgeH

      pushQuad(positions, normals, uvs,
        [x, r0y, r0z], [x, r1y, r1z],
        [x, oy1, oz1], [x, oy0, oz0],
        [1, 0, 0])

      pushQuad(positions, normals, uvs,
        [x, r0y, r0z], [x, r1y, r1z],
        [x - ridgeD, oy1, oz1], [x - ridgeD, oy0, oz0],
        [0, fny, fnz])
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

function buildShingledEndCaps(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry | null {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const peakR = halfW * 0.1
  const slopeY = h * (halfW - peakR) / halfW

  const outerPts: [number, number][] = [[-halfW, 0]]
  for (let i = 0; i <= SHINGLED_PEAK_SEGS; i++) {
    const frac = i / SHINGLED_PEAK_SEGS
    const angle = Math.PI * (1 - frac)
    outerPts.push([
      peakR * Math.cos(angle),
      slopeY + (h - slopeY) * Math.sin(angle),
    ])
  }
  outerPts.push([halfW, 0])

  const innerPts = offsetProfileInward(outerPts, t)

  for (const sign of [-1, 1]) {
    const x = sign * halfLen
    const nx = sign

    for (let i = 0; i < outerPts.length - 1; i++) {
      const [oz0, oy0] = outerPts[i]!
      const [oz1, oy1] = outerPts[i + 1]!
      const [iz0, iy0] = innerPts[i]!
      const [iz1, iy1] = innerPts[i + 1]!

      const a: [number, number, number] = [x, oy0, oz0]
      const b: [number, number, number] = [x, oy1, oz1]
      const c: [number, number, number] = [x, iy1, iz1]
      const d: [number, number, number] = [x, iy0, iz0]

      if (sign > 0) {
        pushQuadVec(positions, normals, uvs, a, b, c, d, [nx, 0, 0])
      } else {
        pushQuadVec(positions, normals, uvs, d, c, b, a, [nx, 0, 0])
      }
    }
  }

  if (positions.length === 0) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

// ---------------------------------------------------------------------------
// Metal: angular bent-metal cap with raised center bead, pronounced drip-edge
// lips, and proper per-face normals for correct lighting
// ---------------------------------------------------------------------------

function buildMetalProfile(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const t = h * SHELL_THICKNESS
  const lipH = h * 0.3
  const lipW = halfW * 0.15
  const beadW = halfW * 0.05
  const beadH = h * 0.12

  const outer: [number, number][] = [
    [-halfW, 0],
    [-halfW + lipW, lipH],
    [-beadW, h],
    [0, h + beadH],
    [beadW, h],
    [halfW - lipW, lipH],
    [halfW, 0],
  ]

  const inner: [number, number][] = [
    [-halfW, t],
    [-halfW + lipW, lipH + t],
    [-beadW, h - t],
    [0, h - t],
    [beadW, h - t],
    [halfW - lipW, lipH + t],
    [halfW, t],
  ]

  const segNormal = (z0: number, y0: number, z1: number, y1: number): number[] => {
    const dz = z1 - z0
    const dy = y1 - y0
    const len = Math.sqrt(dz * dz + dy * dy) || 1
    return [0, dz / len, -dy / len]
  }

  for (let i = 0; i < outer.length - 1; i++) {
    const [oz0, oy0] = outer[i]!
    const [oz1, oy1] = outer[i + 1]!
    const [iz0, iy0] = inner[i]!
    const [iz1, iy1] = inner[i + 1]!

    const outerN = segNormal(oz0, oy0, oz1, oy1)
    const innerN = segNormal(iz0, iy0, iz1, iy1).map(v => -v)

    pushQuad(positions, normals, uvs,
      [-halfLen, oy0, oz0], [halfLen, oy0, oz0],
      [halfLen, oy1, oz1], [-halfLen, oy1, oz1],
      outerN)

    pushQuad(positions, normals, uvs,
      [-halfLen, iy1, iz1], [halfLen, iy1, iz1],
      [halfLen, iy0, iz0], [-halfLen, iy0, iz0],
      innerN)
  }

  pushQuad(positions, normals, uvs,
    [-halfLen, inner[0]![1], inner[0]![0]], [halfLen, inner[0]![1], inner[0]![0]],
    [halfLen, outer[0]![1], outer[0]![0]], [-halfLen, outer[0]![1], outer[0]![0]],
    [0, -1, 0])
  const lastIdx = outer.length - 1
  pushQuad(positions, normals, uvs,
    [-halfLen, outer[lastIdx]![1], outer[lastIdx]![0]], [halfLen, outer[lastIdx]![1], outer[lastIdx]![0]],
    [halfLen, inner[lastIdx]![1], inner[lastIdx]![0]], [-halfLen, inner[lastIdx]![1], inner[lastIdx]![0]],
    [0, -1, 0])

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

// ---------------------------------------------------------------------------
// Metal end caps
// ---------------------------------------------------------------------------
function buildMetalEndCaps(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry | null {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const t = h * SHELL_THICKNESS
  const lipH = h * 0.3
  const lipW = halfW * 0.15
  const beadW = halfW * 0.05
  const beadH = h * 0.12

  const outer: [number, number][] = [
    [-halfW, 0],
    [-halfW + lipW, lipH],
    [-beadW, h],
    [0, h + beadH],
    [beadW, h],
    [halfW - lipW, lipH],
    [halfW, 0],
  ]
  const inner: [number, number][] = [
    [-halfW, t],
    [-halfW + lipW, lipH + t],
    [-beadW, h - t],
    [0, h - t],
    [beadW, h - t],
    [halfW - lipW, lipH + t],
    [halfW, t],
  ]

  for (const sign of [-1, 1]) {
    const x = sign * halfLen
    const nx = sign

    for (let i = 0; i < outer.length - 1; i++) {
      const [oz0, oy0] = outer[i]!
      const [oz1, oy1] = outer[i + 1]!
      const [iz0, iy0] = inner[i]!
      const [iz1, iy1] = inner[i + 1]!

      const a: [number, number, number] = [x, oy0, oz0]
      const b: [number, number, number] = [x, oy1, oz1]
      const c: [number, number, number] = [x, iy1, iz1]
      const d: [number, number, number] = [x, iy0, iz0]

      if (sign > 0) {
        pushQuadVec(positions, normals, uvs, a, b, c, d, [nx, 0, 0])
      } else {
        pushQuadVec(positions, normals, uvs, d, c, b, a, [nx, 0, 0])
      }
    }

    const oLast = outer.length - 1
    const a: [number, number, number] = [x, outer[oLast]![1], outer[oLast]![0]]
    const b: [number, number, number] = [x, inner[oLast]![1], inner[oLast]![0]]
    const c: [number, number, number] = [x, inner[0]![1], inner[0]![0]]
    const d: [number, number, number] = [x, outer[0]![1], outer[0]![0]]

    if (sign > 0) {
      pushQuadVec(positions, normals, uvs, a, b, c, d, [nx, 0, 0])
    } else {
      pushQuadVec(positions, normals, uvs, d, c, b, a, [nx, 0, 0])
    }
  }

  if (positions.length === 0) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function offsetProfileInward(
  pts: [number, number][],
  t: number,
): [number, number][] {
  const result: [number, number][] = []
  for (let i = 0; i < pts.length; i++) {
    const [z, y] = pts[i]!
    let dz: number, dy: number
    if (i === 0) {
      dz = pts[1]![0] - z
      dy = pts[1]![1] - y
    } else if (i === pts.length - 1) {
      dz = z - pts[i - 1]![0]
      dy = y - pts[i - 1]![1]
    } else {
      dz = pts[i + 1]![0] - pts[i - 1]![0]
      dy = pts[i + 1]![1] - pts[i - 1]![1]
    }
    const len = Math.sqrt(dz * dz + dy * dy) || 1
    const nz = dy / len
    const ny = -dz / len
    result.push([z + nz * t, y + ny * t])
  }
  return result
}

function pushQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  a: number[],
  b: number[],
  c: number[],
  d: number[],
  n: number[],
) {
  positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  normals.push(n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!)
  uvs.push(0, 0, 1, 0, 1, 1)
  positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!)
  normals.push(n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!)
  uvs.push(0, 0, 1, 1, 0, 1)
}

function pushQuadVec(
  positions: number[],
  normals: number[],
  uvs: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
  n: number[],
) {
  pushQuad(positions, normals, uvs, a, b, c, d, n)
}
