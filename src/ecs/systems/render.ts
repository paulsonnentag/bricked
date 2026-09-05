import * as THREE from 'three'
import { query } from 'bitecs'
import type { Ctx } from '../../context'
import {
  Car, CORNERS, CORNER_SIGNS, Renderable, Suspension, Transform, Wheel, objects,
} from '../components'

const renderQuery = [Transform, Renderable]
const wheelQuery = [Wheel]

const prevPos = new THREE.Vector3()
const currPos = new THREE.Vector3()
const prevRot = new THREE.Quaternion()
const currRot = new THREE.Quaternion()

/** Blend between the last two physics states so motion is smooth at any frame rate. */
export function interpolateTransformSystem(ctx: Ctx, alpha: number) {
  for (const eid of query(ctx.ecs, renderQuery)) {
    const object = objects[eid]
    if (!object) continue

    prevPos.set(Transform.px[eid], Transform.py[eid], Transform.pz[eid])
    currPos.set(Transform.x[eid], Transform.y[eid], Transform.z[eid])
    prevRot.set(Transform.pqx[eid], Transform.pqy[eid], Transform.pqz[eid], Transform.pqw[eid])
    currRot.set(Transform.qx[eid], Transform.qy[eid], Transform.qz[eid], Transform.qw[eid])

    object.position.lerpVectors(prevPos, currPos, alpha)
    object.quaternion.slerpQuaternions(prevRot, currRot, alpha)
  }
}

/**
 * Wheels hang off the suspension raycast distance, steer with the input, and
 * roll at whatever speed the car is actually travelling.
 */
export function wheelVisualSystem(ctx: Ctx, dt: number) {
  const { suspension, chassis, steering } = ctx.cfg

  for (const eid of query(ctx.ecs, wheelQuery)) {
    const mesh = objects[eid]
    if (!mesh) continue
    const car = Wheel.car[eid]
    const corner = Wheel.corner[eid]
    const [sx, sz] = CORNER_SIGNS[corner]

    const distance = Suspension.grounded[car * CORNERS + corner]
      ? Suspension.distance[car * CORNERS + corner]
      : suspension.restLength

    // The collision box is the full width of the car, so the wheels sit just
    // outside it rather than buried inside. They ride at the raycast depth.
    mesh.position.set(
      sx * (chassis.halfWidth + suspension.wheelWidth * 0.5),
      suspension.originY - distance + suspension.wheelRadius,
      sz * chassis.halfLength * suspension.spreadZ,
    )

    const speed = Car.forwardSpeed[car]
    Wheel.spin[eid] += (speed / Math.max(0.05, suspension.wheelRadius)) * dt
    const steerAngle = Wheel.steered[eid]
      ? Car.visualSteer[car] * THREE.MathUtils.degToRad(steering.maxWheelAngle)
      : 0

    // 'YXZ' steers in chassis space first, then rolls about the steered axle.
    mesh.rotation.set(Wheel.spin[eid], steerAngle, 0, 'YXZ')
  }
}

/** Smooth the steering input purely for the look of the front wheels. */
export function visualSteerSystem(ctx: Ctx, dt: number) {
  const car = ctx.car
  const target = ctx.input.steer
  const rate = 8 * dt
  const current = Car.visualSteer[car]
  Car.visualSteer[car] = current + (target - current) * Math.min(1, rate)
}

const cameraTarget = new THREE.Vector3()
const cameraDesired = new THREE.Vector3()
const cameraLook = new THREE.Vector3()
const chaseForward = new THREE.Vector3()
const flatForward = new THREE.Vector3()

export function cameraSystem(ctx: Ctx, dt: number) {
  const object = objects[ctx.car]
  if (!object) return
  const { camera: cfg } = ctx.cfg

  chaseForward.set(0, 0, 1).applyQuaternion(object.quaternion)
  flatForward.set(chaseForward.x, 0, chaseForward.z)
  if (flatForward.lengthSq() < 1e-4) flatForward.set(0, 0, 1)
  flatForward.normalize()

  // rotateWithCar 0 keeps a fixed heading, 1 sits directly behind the car.
  flatForward.lerp(FIXED_HEADING, 1 - cfg.rotateWithCar).normalize()

  cameraTarget.copy(object.position)
  cameraDesired
    .copy(cameraTarget)
    .addScaledVector(flatForward, -cfg.distance)
    .addScaledVector(UP, cfg.height)

  // Frame-rate independent exponential smoothing.
  const blend = 1 - Math.exp(-cfg.stiffness * dt)
  ctx.camera.position.lerp(cameraDesired, blend)

  cameraLook.copy(cameraTarget).addScaledVector(flatForward, cfg.lookAhead)
  ctx.camera.lookAt(cameraLook)

  if (ctx.camera.fov !== cfg.fov) {
    ctx.camera.fov = cfg.fov
    ctx.camera.updateProjectionMatrix()
  }
}

const UP = new THREE.Vector3(0, 1, 0)
const FIXED_HEADING = new THREE.Vector3(0, 0, 1)
