import type { RoofSegmentNode, SolarPanelNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshStandardNodeMaterial } from 'three/webgpu'

const SOLAR_CELL_SIZE_M = 0.16

export function createSolarPanelTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#dde3ec'
  ctx.fillRect(0, 0, size, size)

  const pad = size * 0.04
  const x = pad
  const y = pad
  const cellW = size - pad * 2
  const cellH = size - pad * 2
  const chamfer = cellW * 0.16

  ctx.beginPath()
  ctx.moveTo(x + chamfer, y)
  ctx.lineTo(x + cellW - chamfer, y)
  ctx.lineTo(x + cellW, y + chamfer)
  ctx.lineTo(x + cellW, y + cellH - chamfer)
  ctx.lineTo(x + cellW - chamfer, y + cellH)
  ctx.lineTo(x + chamfer, y + cellH)
  ctx.lineTo(x, y + cellH - chamfer)
  ctx.lineTo(x, y + chamfer)
  ctx.closePath()

  const grad = ctx.createLinearGradient(x, y, x + cellW, y + cellH)
  grad.addColorStop(0, '#0f1b3a')
  grad.addColorStop(1, '#162546')
  ctx.fillStyle = grad
  ctx.fill()

  ctx.save()
  ctx.clip()
  ctx.strokeStyle = 'rgba(120, 150, 200, 0.10)'
  ctx.lineWidth = 0.5
  const fingers = 16
  for (let f = 1; f < fingers; f++) {
    const fx = x + (cellW * f) / fingers
    ctx.beginPath()
    ctx.moveTo(fx, y)
    ctx.lineTo(fx, y + cellH)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(200, 210, 225, 0.35)'
  ctx.lineWidth = Math.max(1, cellH * 0.008)
  for (let b = 1; b <= 2; b++) {
    const by = y + (cellH * b) / 3
    ctx.beginPath()
    ctx.moveTo(x, by)
    ctx.lineTo(x + cellW, by)
    ctx.stroke()
  }
  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

let _defaultPanelMaterial: THREE.Material | null = null
export function getDefaultPanelMaterial(): THREE.Material {
  if (_defaultPanelMaterial) return _defaultPanelMaterial
  const map = createSolarPanelTexture()
  if (map) {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      roughness: 0.22,
      metalness: 0.35,
      map,
    })
    mat.needsUpdate = true
    _defaultPanelMaterial = mat
  } else {
    _defaultPanelMaterial = new MeshStandardNodeMaterial({
      color: new THREE.Color(0.05, 0.05, 0.12),
      roughness: 0.15,
      metalness: 0.3,
    })
  }
  return _defaultPanelMaterial
}

const _up = new THREE.Vector3(0, 1, 0)
const _normal = new THREE.Vector3()

export function surfaceQuatFromWorldNormal(worldNormal: THREE.Vector3, out: THREE.Quaternion) {
  const right = new THREE.Vector3().crossVectors(_up, worldNormal)
  if (right.lengthSq() < 1e-6) {
    right.set(1, 0, 0)
  } else {
    right.normalize()
  }
  const forward = new THREE.Vector3().crossVectors(right, worldNormal).normalize()
  const m = new THREE.Matrix4().makeBasis(right, worldNormal, forward)
  return out.setFromRotationMatrix(m)
}

export function getSurfaceY(lx: number, lz: number, seg: RoofSegmentNode): number {
  const { roofType, wallHeight, roofHeight, depth, width } = seg
  const rh = roofType === 'flat' ? 0 : roofHeight
  const peakY = wallHeight + rh
  if (rh === 0) return wallHeight

  if (roofType === 'gable') {
    const t = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    return peakY - t * rh
  }
  if (roofType === 'shed') {
    const t = (lz + depth / 2) / (depth || 1)
    return peakY - t * rh
  }
  if (roofType === 'hip') {
    const fx = width > 0 ? Math.abs(lx) / (width / 2) : 0
    const fz = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    return peakY - Math.max(fx, fz) * rh
  }
  const t = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
  return peakY - t * rh
}

export function getAnalyticalNormal(lx: number, lz: number, seg: RoofSegmentNode): THREE.Vector3 {
  const { roofType, roofHeight, depth, width } = seg
  const rh = roofType === 'flat' ? 0 : roofHeight
  if (rh === 0) return _normal.set(0, 1, 0)

  if (roofType === 'gable') {
    const halfD = depth / 2
    return _normal.set(0, halfD, lz >= 0 ? rh : -rh).normalize()
  }
  if (roofType === 'shed') {
    return _normal.set(0, depth, -rh).normalize()
  }
  if (roofType === 'hip') {
    const fx = width > 0 ? Math.abs(lx) / (width / 2) : 0
    const fz = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    if (fz >= fx) {
      return _normal.set(0, depth / 2, lz >= 0 ? rh : -rh).normalize()
    }
    return _normal.set(lx >= 0 ? rh : -rh, width / 2, 0).normalize()
  }
  const halfD = depth / 2
  return _normal.set(0, halfD, lz >= 0 ? rh : -rh).normalize()
}

export function buildSolarPanelGeometry(node: SolarPanelNode): THREE.BufferGeometry | null {
  const {
    rows, columns, panelWidth, panelHeight, gapX, gapY,
    frameThickness, frameDepth, standoffHeight,
  } = node

  const frameGeos: THREE.BufferGeometry[] = []
  const panelGeos: THREE.BufferGeometry[] = []

  const totalW = columns * panelWidth + (columns - 1) * gapX
  const totalH = rows * panelHeight + (rows - 1) * gapY
  const originX = -totalW / 2
  const originZ = -totalH / 2

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cx = originX + c * (panelWidth + gapX) + panelWidth / 2
      const cz = originZ + r * (panelHeight + gapY) + panelHeight / 2
      const y = standoffHeight + frameDepth / 2

      const glassW = panelWidth - 2 * frameThickness
      const glassH = panelHeight - 2 * frameThickness
      if (glassW > 0 && glassH > 0) {
        const glass = new THREE.BoxGeometry(glassW, frameDepth * 0.6, glassH)
        glass.translate(cx, y + frameDepth * 0.2, cz)
        const cellsU = Math.max(1, Math.round(glassW / SOLAR_CELL_SIZE_M))
        const cellsV = Math.max(1, Math.round(glassH / SOLAR_CELL_SIZE_M))
        const uv = glass.getAttribute('uv') as THREE.BufferAttribute
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * cellsU, uv.getY(i) * cellsV)
        }
        uv.needsUpdate = true
        panelGeos.push(glass)
      }

      const ft = frameThickness
      const fd = frameDepth

      const left = new THREE.BoxGeometry(ft, fd, panelHeight)
      left.translate(cx - panelWidth / 2 + ft / 2, y, cz)
      frameGeos.push(left)

      const right = new THREE.BoxGeometry(ft, fd, panelHeight)
      right.translate(cx + panelWidth / 2 - ft / 2, y, cz)
      frameGeos.push(right)

      const top = new THREE.BoxGeometry(panelWidth - 2 * ft, fd, ft)
      top.translate(cx, y, cz - panelHeight / 2 + ft / 2)
      frameGeos.push(top)

      const bottom = new THREE.BoxGeometry(panelWidth - 2 * ft, fd, ft)
      bottom.translate(cx, y, cz + panelHeight / 2 - ft / 2)
      frameGeos.push(bottom)
    }
  }

  if (frameGeos.length === 0) return null

  const frameMerged = mergeGeometries(frameGeos, false)
  const panelMerged = panelGeos.length > 0 ? mergeGeometries(panelGeos, false) : null

  for (const g of frameGeos) g.dispose()
  for (const g of panelGeos) g.dispose()

  if (!frameMerged) return null

  if (panelMerged) {
    const combined = mergeGeometries([frameMerged, panelMerged], true)
    frameMerged.dispose()
    panelMerged.dispose()
    return combined
  }

  frameMerged.clearGroups()
  frameMerged.addGroup(0, frameMerged.index?.count ?? frameMerged.attributes.position!.count, 0)
  return frameMerged
}
