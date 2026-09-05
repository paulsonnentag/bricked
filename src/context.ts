import type * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { World } from 'bitecs'
import type { Config } from './config'
import type { InputState } from './input'
import type { DebugLines } from './debug'

export interface Ctx {
  ecs: World
  physics: RAPIER.World
  rapier: typeof RAPIER
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  cfg: Config
  input: InputState
  debug: DebugLines
  /** the player car entity */
  car: number
  /** fixed physics timestep, seconds */
  dt: number
}
