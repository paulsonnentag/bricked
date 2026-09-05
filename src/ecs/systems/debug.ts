import * as THREE from 'three'
import { query } from 'bitecs'
import type { Ctx } from '../../context'
import { Body, Car, CORNERS, Suspension, bodies } from '../components'
import { cornerOffset } from '../../car'
import { DEBUG_COLORS } from '../../debug'

const carQuery = [Car, Body, Suspension]

const q = new THREE.Quaternion()
const origin = new THREE.Vector3()
const offset = new THREE.Vector3()
const hit = new THREE.Vector3()
const end = new THREE.Vector3()
const dir = new THREE.Vector3()
const up = new THREE.Vector3()
const right = new THREE.Vector3()
const translation = new THREE.Vector3()

/** Draws the state the vehicle systems recorded during the last physics step. */
export function debugDrawSystem(ctx: Ctx) {
  const { debug, suspension, chassis } = ctx.cfg
  ctx.debug.clear()

  const anyEnabled =
    debug.suspension || debug.forces || debug.velocity || debug.contactNormals
  if (!anyEnabled) {
    ctx.debug.flush()
    return
  }

  for (const eid of query(ctx.ecs, carQuery)) {
    const body = bodies[eid]
    if (!body) continue

    const r = body.rotation()
    const t = body.translation()
    q.set(r.x, r.y, r.z, r.w)
    translation.set(t.x, t.y, t.z)
    up.set(0, 1, 0).applyQuaternion(q)
    right.set(1, 0, 0).applyQuaternion(q)

    // Force arrows are scaled so one car-weight of force is one metre long.
    const forceScale = 1 / (chassis.mass * ctx.cfg.physics.gravity)

    for (let corner = 0; corner < CORNERS; corner++) {
      const i = eid * CORNERS + corner
      cornerOffset(ctx, corner, offset).applyQuaternion(q)
      origin.copy(translation).add(offset)

      if (debug.suspension) {
        dir.copy(up).negate()
        end.copy(origin).addScaledVector(dir, suspension.restLength)
        ctx.debug.line(origin, end, DEBUG_COLORS.ray)

        if (Suspension.grounded[i]) {
          hit.set(Suspension.hitX[i], Suspension.hitY[i], Suspension.hitZ[i])
          ctx.debug.line(origin, hit, DEBUG_COLORS.rayHit)
          ctx.debug.cross(hit, 0.12, DEBUG_COLORS.rayHit)
        }
      }

      if (debug.forces && Suspension.grounded[i]) {
        ctx.debug.vector(origin, up, Suspension.force[i] * forceScale, DEBUG_COLORS.springForce)
      }

      if (debug.contactNormals && Suspension.grounded[i]) {
        hit.set(Suspension.hitX[i], Suspension.hitY[i], Suspension.hitZ[i])
        dir.set(Suspension.normalX[i], Suspension.normalY[i], Suspension.normalZ[i])
        ctx.debug.vector(hit, dir, 0.8, DEBUG_COLORS.normal)
      }
    }

    if (debug.forces) {
      dir.set(0, 0, 1).applyQuaternion(q)
      ctx.debug.vector(translation, dir, Car.driveForce[eid] * forceScale, DEBUG_COLORS.driveForce)

      const axleZ = chassis.halfLength * ctx.cfg.grip.axleZ
      offset.set(0, 0, axleZ).applyQuaternion(q)
      origin.copy(translation).add(offset)
      ctx.debug.vector(origin, right, Car.gripFrontForce[eid] * forceScale, DEBUG_COLORS.gripForce)

      offset.set(0, 0, -axleZ).applyQuaternion(q)
      origin.copy(translation).add(offset)
      ctx.debug.vector(origin, right, Car.gripRearForce[eid] * forceScale, DEBUG_COLORS.gripForce)

      // Where the centre of mass actually sits.
      const com = body.worldCom()
      hit.set(com.x, com.y, com.z)
      ctx.debug.cross(hit, 0.2, 0xffffff)
    }

    if (debug.velocity) {
      const lv = body.linvel()
      dir.set(lv.x, lv.y, lv.z)
      ctx.debug.vector(translation, dir, 0.2, DEBUG_COLORS.velocity)
    }
  }

  ctx.debug.flush()
}
