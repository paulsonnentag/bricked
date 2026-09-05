import * as THREE from 'three'
import { addComponent, addEntity } from 'bitecs'
import type { Ctx } from './context'
import {
  Body, Car, CarInput, CORNERS, CORNER_SIGNS, Renderable, Suspension, Transform, Wheel,
  bodies, colliders, isFrontCorner, objects,
} from './ecs/components'

export const SPAWN = new THREE.Vector3(0, 2, -12)

/** Box inertia about its own centre, scaled by the fudge factor. */
function boxInertia(mass: number, hx: number, hy: number, hz: number, scale: number) {
  const k = (mass / 3) * scale
  return {
    x: k * (hy * hy + hz * hz),
    y: k * (hx * hx + hz * hz),
    z: k * (hx * hx + hy * hy),
  }
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }

/** Half-extents the chassis mesh is authored at; config scales relative to these. */
const BASE_HALF = { x: 0.9, y: 0.3, z: 1.9 }
const BASE_WHEEL_RADIUS = 0.35

/** wheel entity ids per car, so the visual system and config updates can find them */
export const wheelEntities: Record<number, number[]> = {}

/** the inner chassis mesh, scaled to match the collider without affecting wheels */
export const chassisShells: Record<number, THREE.Object3D> = {}

/** Push the current chassis config into the existing body and collider. */
export function applyChassisConfig(ctx: Ctx, eid: number) {
  const { chassis, suspension } = ctx.cfg
  const body = bodies[eid]
  const collider = colliders[eid]
  if (!body || !collider) return

  collider.setHalfExtents({ x: chassis.halfWidth, y: chassis.halfHeight, z: chassis.halfLength })
  collider.setFriction(chassis.friction)
  collider.setRestitution(chassis.restitution)

  body.setAdditionalMassProperties(
    chassis.mass,
    { x: 0, y: chassis.comOffsetY, z: chassis.comOffsetZ },
    boxInertia(chassis.mass, chassis.halfWidth, chassis.halfHeight, chassis.halfLength, chassis.inertiaScale),
    IDENTITY,
    true,
  )
  body.setLinearDamping(chassis.linearDamping)
  body.setAngularDamping(chassis.angularDamping)

  const shell = chassisShells[eid]
  if (shell) {
    shell.scale.set(
      chassis.halfWidth / BASE_HALF.x,
      chassis.halfHeight / BASE_HALF.y,
      chassis.halfLength / BASE_HALF.z,
    )
  }

  for (let corner = 0; corner < CORNERS; corner++) {
    const wheel = wheelEntities[eid]?.[corner]
    if (wheel === undefined) continue
    const mesh = objects[wheel]
    if (!mesh) continue
    mesh.scale.setScalar(suspension.wheelRadius / BASE_WHEEL_RADIUS)
  }
}

function makeChassisMesh() {
  const group = new THREE.Group()

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(BASE_HALF.x * 2, BASE_HALF.y * 2, BASE_HALF.z * 2),
    new THREE.MeshStandardMaterial({ color: 0xe8503a, roughness: 0.45, metalness: 0.1 }),
  )
  shell.castShadow = true
  group.add(shell)

  // A cabin and a nose stripe, purely so the car's orientation reads at a glance.
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(BASE_HALF.x * 1.6, BASE_HALF.y * 1.6, BASE_HALF.z * 0.9),
    new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.3 }),
  )
  cabin.position.set(0, BASE_HALF.y * 1.2, -BASE_HALF.z * 0.15)
  cabin.castShadow = true
  shell.add(cabin)

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(BASE_HALF.x * 1.2, BASE_HALF.y * 0.5, BASE_HALF.z * 0.12),
    new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.4 }),
  )
  nose.position.set(0, BASE_HALF.y * 0.9, BASE_HALF.z * 0.85)
  shell.add(nose)

  return { group, shell }
}

function makeWheelMesh(radius: number, width: number) {
  const group = new THREE.Group()
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 18),
    new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.85 }),
  )
  tyre.rotation.z = Math.PI / 2
  tyre.castShadow = true
  group.add(tyre)

  // Spoke marker so wheel spin is visible.
  const spoke = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.05, radius * 1.5, radius * 0.22),
    new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.4, metalness: 0.3 }),
  )
  group.add(spoke)
  return group
}

export function createCar(ctx: Ctx, position = SPAWN): number {
  const { rapier, physics, cfg } = ctx
  const eid = addEntity(ctx.ecs)
  addComponent(ctx.ecs, eid, Transform)
  addComponent(ctx.ecs, eid, Body)
  addComponent(ctx.ecs, eid, Renderable)
  addComponent(ctx.ecs, eid, CarInput)
  addComponent(ctx.ecs, eid, Car)
  addComponent(ctx.ecs, eid, Suspension)

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setCanSleep(false)
  const body = physics.createRigidBody(bodyDesc)

  // Density 0 so the collider contributes no mass; all mass properties come
  // from setAdditionalMassProperties, which lets us place the COM freely.
  const colliderDesc = rapier.ColliderDesc.cuboid(
    cfg.chassis.halfWidth, cfg.chassis.halfHeight, cfg.chassis.halfLength,
  ).setDensity(0)
  const collider = physics.createCollider(colliderDesc, body)

  bodies[eid] = body
  colliders[eid] = collider
  Body.handle[eid] = body.handle

  const { group, shell } = makeChassisMesh()
  ctx.scene.add(group)
  objects[eid] = group
  chassisShells[eid] = shell

  wheelEntities[eid] = []
  for (let corner = 0; corner < CORNERS; corner++) {
    const wheelEid = addEntity(ctx.ecs)
    addComponent(ctx.ecs, wheelEid, Wheel)
    addComponent(ctx.ecs, wheelEid, Renderable)
    Wheel.car[wheelEid] = eid
    Wheel.corner[wheelEid] = corner
    Wheel.spin[wheelEid] = 0
    Wheel.steered[wheelEid] = isFrontCorner(corner) ? 1 : 0

    const mesh = makeWheelMesh(BASE_WHEEL_RADIUS, cfg.suspension.wheelWidth)
    group.add(mesh)
    objects[wheelEid] = mesh
    wheelEntities[eid][corner] = wheelEid
  }

  applyChassisConfig(ctx, eid)
  resetCar(ctx, eid, position)
  return eid
}

export function resetCar(ctx: Ctx, eid: number, position = SPAWN) {
  const body = bodies[eid]
  if (!body) return
  body.setTranslation({ x: position.x, y: position.y, z: position.z }, true)
  body.setRotation(IDENTITY, true)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)

  const t = body.translation()
  const r = body.rotation()
  Transform.x[eid] = Transform.px[eid] = t.x
  Transform.y[eid] = Transform.py[eid] = t.y
  Transform.z[eid] = Transform.pz[eid] = t.z
  Transform.qx[eid] = Transform.pqx[eid] = r.x
  Transform.qy[eid] = Transform.pqy[eid] = r.y
  Transform.qz[eid] = Transform.pqz[eid] = r.z
  Transform.qw[eid] = Transform.pqw[eid] = r.w

  for (let corner = 0; corner < CORNERS; corner++) {
    const i = eid * CORNERS + corner
    Suspension.compression[i] = 0
    Suspension.distance[i] = ctx.cfg.suspension.restLength
    Suspension.grounded[i] = 0
    Suspension.force[i] = 0
  }
}

/** Local-space position of a suspension ray origin for the given corner. */
export function cornerOffset(ctx: Ctx, corner: number, out: THREE.Vector3) {
  const { chassis, suspension } = ctx.cfg
  const [sx, sz] = CORNER_SIGNS[corner]
  return out.set(
    sx * chassis.halfWidth * suspension.spreadX,
    suspension.originY,
    sz * chassis.halfLength * suspension.spreadZ,
  )
}
