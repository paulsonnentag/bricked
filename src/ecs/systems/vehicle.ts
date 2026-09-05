import * as THREE from 'three'
import { query } from 'bitecs'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Ctx } from '../../context'
import { Body, Car, CarInput, CORNERS, Suspension, bodies, isFrontCorner } from '../components'
import { cornerOffset } from '../../car'

const carQuery = [Car, Body, Suspension]

// Scratch vectors - the physics runs at a fixed step, so allocation here would
// be pure garbage-collector churn.
const q = new THREE.Quaternion()
const right = new THREE.Vector3()
const up = new THREE.Vector3()
const forward = new THREE.Vector3()
const forwardOnPlane = new THREE.Vector3()
const groundNormal = new THREE.Vector3()
const translation = new THREE.Vector3()
const offset = new THREE.Vector3()
const worldPoint = new THREE.Vector3()
const rayDir = new THREE.Vector3()
const velocity = new THREE.Vector3()
const linear = new THREE.Vector3()
const angular = new THREE.Vector3()
const lever = new THREE.Vector3()
const force = new THREE.Vector3()
const axis = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/** One reusable ray; Rapier is happy to have its origin and direction mutated. */
let sharedRay: RAPIER.Ray | null = null
function getRay(rapier: typeof RAPIER) {
  if (!sharedRay) sharedRay = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  return sharedRay
}

function readBasis(body: NonNullable<(typeof bodies)[number]>) {
  const r = body.rotation()
  const t = body.translation()
  q.set(r.x, r.y, r.z, r.w)
  translation.set(t.x, t.y, t.z)
  right.set(1, 0, 0).applyQuaternion(q)
  up.set(0, 1, 0).applyQuaternion(q)
  forward.set(0, 0, 1).applyQuaternion(q)
}

/** Velocity of a world-space point on the body: v + w x r. */
function pointVelocity(
  body: NonNullable<(typeof bodies)[number]>,
  point: THREE.Vector3,
  out: THREE.Vector3,
) {
  const lv = body.linvel()
  const av = body.angvel()
  const com = body.worldCom()
  lever.set(point.x - com.x, point.y - com.y, point.z - com.z)
  angular.set(av.x, av.y, av.z)
  linear.set(lv.x, lv.y, lv.z)
  // `out` may alias one of the scratch vectors, so write to it last.
  return out.copy(angular).cross(lever).add(linear)
}

/** Yaw inertia of the chassis box, used to keep the steering slider mass-independent. */
function yawInertia(ctx: Ctx) {
  const { mass, halfWidth, halfLength, inertiaScale } = ctx.cfg.chassis
  return (mass / 3) * inertiaScale * (halfWidth * halfWidth + halfLength * halfLength)
}

function rollInertia(ctx: Ctx) {
  const { mass, halfHeight, halfLength, inertiaScale } = ctx.cfg.chassis
  return (mass / 3) * inertiaScale * (halfHeight * halfHeight + halfLength * halfLength)
}

/**
 * Rapier keeps user forces in an accumulator that survives `step()`, so every
 * force this frame's systems apply has to start from a clean slate.
 */
export function clearForcesSystem(ctx: Ctx) {
  for (const eid of query(ctx.ecs, carQuery)) {
    const body = bodies[eid]
    if (!body) continue
    body.resetForces(false)
    body.resetTorques(false)
  }
}

/**
 * Four downward raycasts from the chassis corners. Each one that hits pushes the
 * corner up with a spring force scaled by how far the suspension is compressed,
 * damped by how fast that corner is moving along the car's up axis.
 */
export function suspensionSystem(ctx: Ctx) {
  const { physics, rapier, cfg } = ctx
  const { suspension, chassis, physics: phys } = cfg
  const gravity = phys.gravity
  const maxAccel = suspension.maxForce * gravity

  for (const eid of query(ctx.ecs, carQuery)) {
    const body = bodies[eid]
    if (!body) continue
    readBasis(body)

    rayDir.copy(up).negate()
    groundNormal.set(0, 0, 0)
    let grounded = 0

    for (let corner = 0; corner < CORNERS; corner++) {
      const i = eid * CORNERS + corner
      cornerOffset(ctx, corner, offset).applyQuaternion(q)
      worldPoint.copy(translation).add(offset)

      const ray = getRay(rapier)
      ray.origin.x = worldPoint.x
      ray.origin.y = worldPoint.y
      ray.origin.z = worldPoint.z
      ray.dir.x = rayDir.x
      ray.dir.y = rayDir.y
      ray.dir.z = rayDir.z

      const hit = physics.castRayAndGetNormal(
        ray,
        suspension.restLength,
        true,
        undefined,
        undefined,
        undefined,
        body,
      )

      if (!hit) {
        Suspension.compression[i] = 0
        Suspension.distance[i] = suspension.restLength
        Suspension.grounded[i] = 0
        Suspension.force[i] = 0
        continue
      }

      const distance = hit.timeOfImpact
      const compression = 1 - distance / suspension.restLength

      pointVelocity(body, worldPoint, velocity)
      const upSpeed = velocity.dot(up)

      const springAccel = suspension.stiffness * compression * gravity
      const damperAccel = suspension.damping * upSpeed
      const accel = Math.max(0, Math.min(maxAccel, springAccel - damperAccel))

      force.copy(up).multiplyScalar(accel * chassis.mass)
      body.addForceAtPoint(force, worldPoint, true)

      Suspension.compression[i] = compression
      Suspension.distance[i] = distance
      Suspension.grounded[i] = 1
      Suspension.force[i] = accel * chassis.mass
      Suspension.hitX[i] = worldPoint.x + rayDir.x * distance
      Suspension.hitY[i] = worldPoint.y + rayDir.y * distance
      Suspension.hitZ[i] = worldPoint.z + rayDir.z * distance
      Suspension.normalX[i] = hit.normal.x
      Suspension.normalY[i] = hit.normal.y
      Suspension.normalZ[i] = hit.normal.z

      groundNormal.x += hit.normal.x
      groundNormal.y += hit.normal.y
      groundNormal.z += hit.normal.z
      grounded++
    }

    if (grounded > 0 && groundNormal.lengthSq() > 1e-6) {
      groundNormal.normalize()
    } else {
      groundNormal.copy(WORLD_UP)
    }

    Car.groundedCount[eid] = grounded
    Car.normalX[eid] = groundNormal.x
    Car.normalY[eid] = groundNormal.y
    Car.normalZ[eid] = groundNormal.z

    const lv = body.linvel()
    velocity.set(lv.x, lv.y, lv.z)
    Car.forwardSpeed[eid] = velocity.dot(forward)
    Car.lateralSpeed[eid] = velocity.dot(right)
  }
}

/**
 * Throttle and brake. The push is projected onto the ground plane so the car
 * doesn't dig in or take off when it's pitched, and applied below and ahead of
 * the centre of mass so it squats and dives.
 */
export function driveSystem(ctx: Ctx) {
  const { cfg } = ctx
  const { drive, chassis, grip } = cfg

  for (const eid of query(ctx.ecs, carQuery)) {
    const body = bodies[eid]
    if (!body) continue
    readBasis(body)

    const grounded = Car.groundedCount[eid]
    Car.driveForce[eid] = 0
    if (grounded === 0) continue

    groundNormal.set(Car.normalX[eid], Car.normalY[eid], Car.normalZ[eid])
    forwardOnPlane.copy(forward).addScaledVector(groundNormal, -forward.dot(groundNormal))
    if (forwardOnPlane.lengthSq() < 1e-6) continue
    forwardOnPlane.normalize()

    const traction = grounded / CORNERS
    const throttle = CarInput.throttle[eid]
    const fwdSpeed = Car.forwardSpeed[eid]

    let accel = 0
    if (throttle > 0) {
      if (fwdSpeed < -0.5) {
        // Still rolling backwards: this is braking, not acceleration.
        accel = drive.brakeForce * throttle
      } else {
        const headroom = Math.max(0, 1 - fwdSpeed / drive.maxSpeed)
        accel = drive.accelForce * throttle * headroom
        if (CarInput.handbrake[eid]) accel *= grip.handbrakeDriveCut
      }
    } else if (throttle < 0) {
      if (fwdSpeed > 0.5) {
        accel = drive.brakeForce * throttle
      } else {
        const headroom = Math.max(0, 1 - Math.abs(fwdSpeed) / (drive.maxSpeed * 0.5))
        accel = drive.reverseForce * throttle * headroom
      }
    }

    accel *= traction

    if (accel !== 0) {
      offset.set(0, drive.forceOffsetY, drive.forceOffsetZ).applyQuaternion(q)
      worldPoint.copy(translation).add(offset)
      force.copy(forwardOnPlane).multiplyScalar(accel * chassis.mass)
      body.addForceAtPoint(force, worldPoint, true)
      Car.driveForce[eid] = accel * chassis.mass
    }

    // Rolling resistance, so the car coasts to a stop instead of gliding.
    if (drive.rollingResistance > 0) {
      force
        .copy(forwardOnPlane)
        .multiplyScalar(-fwdSpeed * drive.rollingResistance * chassis.mass * traction)
      body.addForce(force, true)
    }

    // Downforce keeps the car planted as it gets faster.
    if (drive.downforce > 0) {
      const speedRatio = Math.min(1, Math.abs(fwdSpeed) / drive.maxSpeed)
      force
        .copy(up)
        .multiplyScalar(-drive.downforce * speedRatio * speedRatio * cfg.physics.gravity * chassis.mass)
      body.addForce(force, true)
    }
  }
}

/**
 * Steering is a yaw torque, not a direct rotation, so walls and other bodies can
 * still push back on the car.
 */
export function steeringSystem(ctx: Ctx) {
  const { steering, drive } = ctx.cfg

  for (const eid of query(ctx.ecs, carQuery)) {
    const body = bodies[eid]
    if (!body) continue
    readBasis(body)

    const grounded = Car.groundedCount[eid]
    const traction = grounded > 0 ? grounded / CORNERS : steering.airControl
    const speed = Math.abs(Car.forwardSpeed[eid])

    const ramp = steering.rampSpeed > 0 ? Math.min(1, speed / steering.rampSpeed) : 1
    const falloff = 1 - steering.highSpeedFalloff * Math.min(1, speed / drive.maxSpeed)
    const authority = ramp * falloff * traction

    const inertia = yawInertia(ctx)
    const direction = Math.sign(Car.forwardSpeed[eid]) || 1
    let torque = CarInput.steer[eid] * steering.torque * authority * direction

    // Counter-torque, otherwise the car keeps yawing after the input stops.
    const av = body.angvel()
    angular.set(av.x, av.y, av.z)
    torque -= angular.dot(up) * steering.yawDamping

    force.copy(up).multiplyScalar(torque * inertia)
    body.addTorque(force, true)
    Car.steerTorque[eid] = torque * inertia
  }
}

/**
 * Traction: cancel the sideways component of velocity. Front and rear axles are
 * separate so the balance between them decides understeer versus oversteer.
 */
export function gripSystem(ctx: Ctx) {
  const { grip, chassis } = ctx.cfg

  for (const eid of query(ctx.ecs, carQuery)) {
    const body = bodies[eid]
    if (!body) continue
    if (Car.groundedCount[eid] === 0) {
      Car.gripFrontForce[eid] = 0
      Car.gripRearForce[eid] = 0
      continue
    }
    readBasis(body)

    const handbrake = CarInput.handbrake[eid] === 1
    const axleZ = chassis.halfLength * grip.axleZ

    for (let axle = 0; axle < 2; axle++) {
      const front = axle === 0
      let groundedOnAxle = 0
      for (let corner = 0; corner < CORNERS; corner++) {
        if (isFrontCorner(corner) === front && Suspension.grounded[eid * CORNERS + corner]) {
          groundedOnAxle++
        }
      }
      if (groundedOnAxle === 0) {
        if (front) Car.gripFrontForce[eid] = 0
        else Car.gripRearForce[eid] = 0
        continue
      }

      offset.set(0, 0, front ? axleZ : -axleZ).applyQuaternion(q)
      worldPoint.copy(translation).add(offset)

      pointVelocity(body, worldPoint, velocity)
      const lateral = velocity.dot(right)

      let rate = front ? grip.front : grip.rear
      if (!front && handbrake) rate *= grip.handbrakeRear

      // Half the mass per axle, scaled by how many of its wheels are down.
      const magnitude = -lateral * rate * chassis.mass * 0.5 * (groundedOnAxle / 2)
      force.copy(right).multiplyScalar(magnitude)
      body.addForceAtPoint(force, worldPoint, true)

      if (front) Car.gripFrontForce[eid] = magnitude
      else Car.gripRearForce[eid] = magnitude
    }
  }
}

/** Nudge the car back onto its wheels once it's tipped past the threshold. */
export function rightingSystem(ctx: Ctx) {
  const { righting, chassis, physics: phys } = ctx.cfg
  if (righting.torque <= 0) return
  const minTilt = THREE.MathUtils.degToRad(righting.minTilt)

  for (const eid of query(ctx.ecs, carQuery)) {
    const body = bodies[eid]
    if (!body) continue
    if (Car.groundedCount[eid] === CORNERS) continue
    readBasis(body)

    const tilt = Math.acos(THREE.MathUtils.clamp(up.dot(WORLD_UP), -1, 1))
    if (tilt < minTilt) continue

    const amount = THREE.MathUtils.clamp((tilt - minTilt) / (Math.PI - minTilt), 0, 1)
    axis.copy(up).cross(WORLD_UP)
    // Exactly upside down gives a degenerate axis; roll about the car's length.
    if (axis.lengthSq() < 1e-4) axis.copy(forward)
    axis.normalize()

    // Rolling the car off its roof means lifting the centre of mass over the
    // bottom edge, so the drive term is scaled by that tip-over torque.
    const tipOver = chassis.mass * phys.gravity * chassis.halfWidth

    // Damped, otherwise the car overshoots upright and barrel-rolls forever.
    const av = body.angvel()
    angular.set(av.x, av.y, av.z)
    const spin = angular.dot(axis)

    const magnitude = righting.torque * amount * tipOver - spin * righting.damping * rollInertia(ctx)
    force.copy(axis).multiplyScalar(magnitude)
    body.addTorque(force, true)
  }
}
