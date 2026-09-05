import * as THREE from 'three'

const MAX_LINES = 4096

/**
 * Immediate-mode line drawing. Systems call `line()` while stepping, and the
 * accumulated segments are uploaded once per frame.
 */
export class DebugLines {
  readonly object: THREE.LineSegments
  private positions = new Float32Array(MAX_LINES * 6)
  private colors = new Float32Array(MAX_LINES * 6)
  private count = 0

  constructor() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    geometry.setDrawRange(0, 0)
    this.object = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
    )
    this.object.frustumCulled = false
    this.object.renderOrder = 999
  }

  clear() {
    this.count = 0
  }

  line(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    if (this.count >= MAX_LINES) return
    const p = this.count * 6
    this.positions[p] = from.x
    this.positions[p + 1] = from.y
    this.positions[p + 2] = from.z
    this.positions[p + 3] = to.x
    this.positions[p + 4] = to.y
    this.positions[p + 5] = to.z

    const r = ((color >> 16) & 0xff) / 255
    const g = ((color >> 8) & 0xff) / 255
    const b = (color & 0xff) / 255
    this.colors[p] = this.colors[p + 3] = r
    this.colors[p + 1] = this.colors[p + 4] = g
    this.colors[p + 2] = this.colors[p + 5] = b

    this.count++
  }

  /** Draw a direction scaled from an origin, e.g. a force or velocity vector. */
  vector(origin: THREE.Vector3, direction: THREE.Vector3, scale: number, color: number) {
    TMP.copy(direction).multiplyScalar(scale).add(origin)
    this.line(origin, TMP, color)
  }

  cross(at: THREE.Vector3, size: number, color: number) {
    for (const axis of AXES) {
      TMP.copy(at).addScaledVector(axis, size)
      TMP2.copy(at).addScaledVector(axis, -size)
      this.line(TMP2, TMP, color)
    }
  }

  flush() {
    const geometry = this.object.geometry
    geometry.setDrawRange(0, this.count * 2)
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const color = geometry.getAttribute('color') as THREE.BufferAttribute
    position.updateRanges = [{ start: 0, count: this.count * 6 }]
    color.updateRanges = [{ start: 0, count: this.count * 6 }]
    position.needsUpdate = true
    color.needsUpdate = true
  }
}

const TMP = new THREE.Vector3()
const TMP2 = new THREE.Vector3()
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
]

export const DEBUG_COLORS = {
  ray: 0x4cc9f0,
  rayHit: 0xf72585,
  springForce: 0x80ed99,
  driveForce: 0xffd166,
  gripForce: 0xff6b6b,
  velocity: 0xffffff,
  normal: 0xb388ff,
}
