import { query } from 'bitecs'
import type { Ctx } from '../../context'
import { Body, Transform, bodies } from '../components'

const bodyQuery = [Transform, Body]

/** Push live config into the solver, then advance one fixed step. */
export function physicsStepSystem(ctx: Ctx) {
  ctx.physics.gravity = { x: 0, y: -ctx.cfg.physics.gravity, z: 0 }
  ctx.physics.timestep = ctx.dt
  ctx.physics.step()
}

/**
 * Copy Rapier's state into Transform, keeping the previous step's values so the
 * renderer can interpolate between them.
 */
export function syncTransformSystem(ctx: Ctx) {
  for (const eid of query(ctx.ecs, bodyQuery)) {
    const body = bodies[eid]
    if (!body) continue

    Transform.px[eid] = Transform.x[eid]
    Transform.py[eid] = Transform.y[eid]
    Transform.pz[eid] = Transform.z[eid]
    Transform.pqx[eid] = Transform.qx[eid]
    Transform.pqy[eid] = Transform.qy[eid]
    Transform.pqz[eid] = Transform.qz[eid]
    Transform.pqw[eid] = Transform.qw[eid]

    const t = body.translation()
    const r = body.rotation()
    Transform.x[eid] = t.x
    Transform.y[eid] = t.y
    Transform.z[eid] = t.z
    Transform.qx[eid] = r.x
    Transform.qy[eid] = r.y
    Transform.qz[eid] = r.z
    Transform.qw[eid] = r.w
  }
}
