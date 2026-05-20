import type { BoxVentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const LOUVER_COUNT = 4
const LOUVER_INSET = 0.012

export function buildBoxVentGeometry(node: BoxVentNode): THREE.BufferGeometry | null {
  const w = node.width
  const d = node.depth
  const h = node.height
  const overhang = node.hoodOverhang
  const style = node.style

  const bodyH = style === 'low-profile' ? h * 0.55 : h * 0.62
  const hoodH = h - bodyH

  const geometries: THREE.BufferGeometry[] = []

  geometries.push(buildBody(w, d, bodyH))
  geometries.push(buildLouvers(w, d, bodyH))

  if (style === 'dome') {
    geometries.push(buildDomeHood(w, d, overhang, bodyH, hoodH))
  } else {
    geometries.push(buildPyramidHood(w, d, overhang, bodyH, hoodH))
  }

  const merged =
    geometries.length === 1
      ? geometries[0]!
      : mergeGeometries(geometries, false) ?? geometries[0]!

  return merged
}

// ---------------------------------------------------------------------------
// Body — rectangular box with vertical sides (top covered by hood)
// Base at y=0, top at y=bodyH
// ---------------------------------------------------------------------------
function buildBody(w: number, d: number, bodyH: number): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  // +X side
  pushQuad(positions, normals, uvs,
    [hw, 0, -hd], [hw, 0, hd], [hw, bodyH, hd], [hw, bodyH, -hd],
    [1, 0, 0])
  // -X side
  pushQuad(positions, normals, uvs,
    [-hw, 0, hd], [-hw, 0, -hd], [-hw, bodyH, -hd], [-hw, bodyH, hd],
    [-1, 0, 0])
  // +Z side
  pushQuad(positions, normals, uvs,
    [hw, 0, hd], [-hw, 0, hd], [-hw, bodyH, hd], [hw, bodyH, hd],
    [0, 0, 1])
  // -Z side
  pushQuad(positions, normals, uvs,
    [-hw, 0, -hd], [hw, 0, -hd], [hw, bodyH, -hd], [-hw, bodyH, -hd],
    [0, 0, -1])
  // Bottom
  pushQuad(positions, normals, uvs,
    [-hw, 0, -hd], [-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd],
    [0, -1, 0])

  return buildGeometry(positions, normals, uvs)
}

// ---------------------------------------------------------------------------
// Louvers — horizontal slat ridges on the four sides, sunken into the body
// to suggest ventilation openings.
// ---------------------------------------------------------------------------
function buildLouvers(w: number, d: number, bodyH: number): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const margin = bodyH * 0.18
  const usable = bodyH - margin * 2
  const slatH = usable / (LOUVER_COUNT * 2 - 1)
  const slatGap = slatH

  for (let i = 0; i < LOUVER_COUNT; i++) {
    const y0 = margin + i * (slatH + slatGap)
    const y1 = y0 + slatH

    // +X face louver — slightly recessed
    const xIn = hw - LOUVER_INSET
    pushQuad(positions, normals, uvs,
      [xIn, y0, -hd * 0.85], [xIn, y0, hd * 0.85],
      [xIn, y1, hd * 0.85], [xIn, y1, -hd * 0.85],
      [1, 0, 0])
    // -X face louver
    pushQuad(positions, normals, uvs,
      [-xIn, y0, hd * 0.85], [-xIn, y0, -hd * 0.85],
      [-xIn, y1, -hd * 0.85], [-xIn, y1, hd * 0.85],
      [-1, 0, 0])
    // +Z face
    const zIn = hd - LOUVER_INSET
    pushQuad(positions, normals, uvs,
      [hw * 0.85, y0, zIn], [-hw * 0.85, y0, zIn],
      [-hw * 0.85, y1, zIn], [hw * 0.85, y1, zIn],
      [0, 0, 1])
    // -Z face
    pushQuad(positions, normals, uvs,
      [-hw * 0.85, y0, -zIn], [hw * 0.85, y0, -zIn],
      [hw * 0.85, y1, -zIn], [-hw * 0.85, y1, -zIn],
      [0, 0, -1])
  }

  return buildGeometry(positions, normals, uvs)
}

// ---------------------------------------------------------------------------
// Pyramid hood — flat-top truncated pyramid with overhang at the base.
// Bottom (where hood meets body) is at y=bodyH and width = w + 2*overhang.
// Top is at y=bodyH+hoodH and width = w*0.6 (tapered).
// ---------------------------------------------------------------------------
function buildPyramidHood(
  w: number,
  d: number,
  overhang: number,
  bodyH: number,
  hoodH: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const bw = w / 2 + overhang
  const bd = d / 2 + overhang
  const tw = w * 0.3
  const td = d * 0.3

  const y0 = bodyH
  const y1 = bodyH + hoodH

  // Underside skirt (visible from below where it overhangs the body)
  pushQuad(positions, normals, uvs,
    [-bw, y0, -bd], [-bw, y0, bd], [bw, y0, bd], [bw, y0, -bd],
    [0, -1, 0])

  // +X sloped face
  pushQuad(positions, normals, uvs,
    [bw, y0, -bd], [bw, y0, bd], [tw, y1, td], [tw, y1, -td],
    computeFaceNormal(bw - tw, hoodH))
  // -X sloped face
  pushQuad(positions, normals, uvs,
    [-bw, y0, bd], [-bw, y0, -bd], [-tw, y1, -td], [-tw, y1, td],
    [-(bw - tw), hoodH, 0], true)
  // +Z sloped face
  pushQuad(positions, normals, uvs,
    [bw, y0, bd], [-bw, y0, bd], [-tw, y1, td], [tw, y1, td],
    [0, hoodH, bd - td], true)
  // -Z sloped face
  pushQuad(positions, normals, uvs,
    [-bw, y0, -bd], [bw, y0, -bd], [tw, y1, -td], [-tw, y1, -td],
    [0, hoodH, -(bd - td)], true)

  // Flat top
  pushQuad(positions, normals, uvs,
    [-tw, y1, -td], [-tw, y1, td], [tw, y1, td], [tw, y1, -td],
    [0, 1, 0])

  return buildGeometry(positions, normals, uvs)
}

// ---------------------------------------------------------------------------
// Dome hood — half-ellipsoid cap (low-rise dome) with overhang skirt.
// ---------------------------------------------------------------------------
function buildDomeHood(
  w: number,
  d: number,
  overhang: number,
  bodyH: number,
  hoodH: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const bw = w / 2 + overhang
  const bd = d / 2 + overhang
  const y0 = bodyH

  // Skirt underside
  pushQuad(positions, normals, uvs,
    [-bw, y0, -bd], [-bw, y0, bd], [bw, y0, bd], [bw, y0, -bd],
    [0, -1, 0])

  // Approximate dome via spherical sampling (5 lat × 8 lng)
  const lat = 5
  const lng = 12
  const points: THREE.Vector3[][] = []
  for (let i = 0; i <= lat; i++) {
    const row: THREE.Vector3[] = []
    const phi = (Math.PI / 2) * (i / lat) // 0 (equator) → PI/2 (top)
    const r = Math.cos(phi)
    const y = y0 + hoodH * Math.sin(phi)
    for (let j = 0; j <= lng; j++) {
      const theta = (Math.PI * 2) * (j / lng)
      const x = bw * r * Math.cos(theta)
      const z = bd * r * Math.sin(theta)
      row.push(new THREE.Vector3(x, y, z))
    }
    points.push(row)
  }

  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lng; j++) {
      const a = points[i]![j]!
      const b = points[i]![j + 1]!
      const c = points[i + 1]![j + 1]!
      const d = points[i + 1]![j]!
      const n = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(b, a),
        new THREE.Vector3().subVectors(d, a),
      ).normalize()
      pushQuad(positions, normals, uvs,
        [a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z], [d.x, d.y, d.z],
        [n.x, n.y, n.z])
    }
  }

  return buildGeometry(positions, normals, uvs)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGeometry(positions: number[], normals: number[], uvs: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
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
  _normalize?: boolean,
) {
  const nLen = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]!) || 1
  const nx = n[0]! / nLen
  const ny = n[1]! / nLen
  const nz = n[2]! / nLen

  positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  uvs.push(0, 0, 1, 0, 1, 1)
  positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!)
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  uvs.push(0, 0, 1, 1, 0, 1)
}

function computeFaceNormal(run: number, rise: number): number[] {
  return [run, rise, 0]
}
