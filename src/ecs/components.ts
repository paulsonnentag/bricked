import type * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'

export const MAX_ENTITIES = 2048
export const CORNERS = 4

const f32 = () => new Float32Array(MAX_ENTITIES)
const f32x4 = () => new Float32Array(MAX_ENTITIES * CORNERS)
const u8 = () => new Uint8Array(MAX_ENTITIES)
const u8x4 = () => new Uint8Array(MAX_ENTITIES * CORNERS)
const u32 = () => new Uint32Array(MAX_ENTITIES)

/** Current and previous physics transform, so rendering can interpolate. */
export const Transform = {
  x: f32(), y: f32(), z: f32(),
  qx: f32(), qy: f32(), qz: f32(), qw: f32(),
  px: f32(), py: f32(), pz: f32(),
  pqx: f32(), pqy: f32(), pqz: f32(), pqw: f32(),
}

/** Handle into the Rapier world. */
export const Body = {
  handle: u32(),
}

/** Marker; the actual three.js object lives in the `objects` side table. */
export const Renderable = {}

export const CarInput = {
  throttle: f32(),
  steer: f32(),
  handbrake: u8(),
}

export const Car = {
  /** signed speed along the car's forward axis, m/s */
  forwardSpeed: f32(),
  /** sideways speed at the chassis centre, m/s */
  lateralSpeed: f32(),
  groundedCount: u8(),
  /** smoothed steer value used for the visual front wheels */
  visualSteer: f32(),
  /** averaged contact normal, falls back to world up when airborne */
  normalX: f32(), normalY: f32(), normalZ: f32(),
  /** last frame's applied magnitudes, kept for the debug overlay */
  driveForce: f32(),
  gripFrontForce: f32(),
  gripRearForce: f32(),
  steerTorque: f32(),
}

/** Per-corner suspension state, indexed as eid * CORNERS + corner. */
export const Suspension = {
  compression: f32x4(),
  /** raycast distance, equals restLength when nothing was hit */
  distance: f32x4(),
  grounded: u8x4(),
  force: f32x4(),
  hitX: f32x4(), hitY: f32x4(), hitZ: f32x4(),
  normalX: f32x4(), normalY: f32x4(), normalZ: f32x4(),
}

export const Wheel = {
  car: u32(),
  corner: u8(),
  /** accumulated rolling rotation, radians */
  spin: f32(),
  steered: u8(),
}

/** Object references can't live in typed arrays, so they get side tables. */
export const objects: (THREE.Object3D | undefined)[] = []
export const bodies: (RAPIER.RigidBody | undefined)[] = []
export const colliders: (RAPIER.Collider | undefined)[] = []

/** Corner layout: 0 = front left, 1 = front right, 2 = rear left, 3 = rear right. */
export const CORNER_SIGNS: ReadonlyArray<readonly [number, number]> = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
]

export const isFrontCorner = (corner: number) => corner < 2
