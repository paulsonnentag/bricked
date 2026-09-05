import * as THREE from 'three'
import { addComponent, addEntity } from 'bitecs'
import type { Ctx } from './context'
import { Body, Renderable, Transform, bodies, objects } from './ecs/components'

interface BoxSpec {
  size: [number, number, number]
  pos: [number, number, number]
  /** rotation about X then Y, in degrees */
  tilt?: number
  yaw?: number
  color: number
}

const STATIC_MATERIALS = new Map<number, THREE.Material>()
function materialFor(color: number, roughness = 0.9) {
  let mat = STATIC_MATERIALS.get(color)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness })
    STATIC_MATERIALS.set(color, mat)
  }
  return mat
}

function quatFrom(tilt = 0, yaw = 0) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(tilt), THREE.MathUtils.degToRad(yaw), 0, 'YXZ'),
  )
}

function addStaticBox(ctx: Ctx, spec: BoxSpec) {
  const { rapier, physics } = ctx
  const [hx, hy, hz] = spec.size
  const q = quatFrom(spec.tilt, spec.yaw)

  const body = physics.createRigidBody(
    rapier.RigidBodyDesc.fixed()
      .setTranslation(spec.pos[0], spec.pos[1], spec.pos[2])
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  )
  physics.createCollider(rapier.ColliderDesc.cuboid(hx, hy, hz).setFriction(1.0), body)

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), materialFor(spec.color))
  mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2])
  mesh.quaternion.copy(q)
  mesh.receiveShadow = true
  mesh.castShadow = true
  ctx.scene.add(mesh)
  return mesh
}

function addDynamicBox(ctx: Ctx, spec: BoxSpec, mass: number) {
  const { rapier, physics } = ctx
  const [hx, hy, hz] = spec.size
  const eid = addEntity(ctx.ecs)
  addComponent(ctx.ecs, eid, Transform)
  addComponent(ctx.ecs, eid, Body)
  addComponent(ctx.ecs, eid, Renderable)

  const body = physics.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(spec.pos[0], spec.pos[1], spec.pos[2])
      .setLinearDamping(0.15)
      .setAngularDamping(0.25),
  )
  physics.createCollider(
    rapier.ColliderDesc.cuboid(hx, hy, hz)
      .setDensity(mass / (8 * hx * hy * hz))
      .setFriction(0.7)
      .setRestitution(0.2),
    body,
  )

  bodies[eid] = body
  Body.handle[eid] = body.handle

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), materialFor(spec.color, 0.7))
  mesh.castShadow = true
  mesh.receiveShadow = true
  ctx.scene.add(mesh)
  objects[eid] = mesh

  Transform.x[eid] = Transform.px[eid] = spec.pos[0]
  Transform.y[eid] = Transform.py[eid] = spec.pos[1]
  Transform.z[eid] = Transform.pz[eid] = spec.pos[2]
  Transform.qw[eid] = Transform.pqw[eid] = 1
  return eid
}

const GROUND_HALF = 110

export function buildWorld(ctx: Ctx) {
  const { rapier, physics } = ctx

  // Flat floor.
  const ground = physics.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 0))
  physics.createCollider(
    rapier.ColliderDesc.cuboid(GROUND_HALF, 1, GROUND_HALF).setFriction(1.0),
    ground,
  )

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(GROUND_HALF * 2, 2, GROUND_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.95 }),
  )
  floor.position.y = -1
  floor.receiveShadow = true
  ctx.scene.add(floor)

  const grid = new THREE.GridHelper(GROUND_HALF * 2, GROUND_HALF, 0x94a3b8, 0x7c8899)
  grid.position.y = 0.01
  ctx.scene.add(grid)

  // Ramps at a few gradients, so jumps and landings can be tested.
  const ramps: BoxSpec[] = [
    { size: [4, 0.4, 7], pos: [-16, 0.6, 14], tilt: -10, color: 0x8b9dc3 },
    { size: [4, 0.4, 7], pos: [0, 1.2, 22], tilt: -20, color: 0x8b9dc3 },
    { size: [4, 0.4, 8], pos: [16, 2.0, 30], tilt: -30, color: 0x8b9dc3 },
    // A wide launch ramp facing back down the field.
    { size: [7, 0.4, 9], pos: [-2, 1.6, -34], tilt: 22, color: 0x9fb3a0 },
  ]
  for (const ramp of ramps) addStaticBox(ctx, ramp)

  // Static obstacles: a couple of walls and some pillars to bounce off.
  const obstacles: BoxSpec[] = [
    { size: [8, 1.2, 0.5], pos: [22, 1.2, -6], yaw: 20, color: 0xb08968 },
    { size: [10, 1.2, 0.5], pos: [-24, 1.2, -2], yaw: -35, color: 0xb08968 },
    { size: [0.6, 2.0, 0.6], pos: [8, 2.0, 6], color: 0x7f8c8d },
    { size: [0.6, 2.0, 0.6], pos: [12, 2.0, 10], color: 0x7f8c8d },
    { size: [0.6, 2.0, 0.6], pos: [4, 2.0, 12], color: 0x7f8c8d },
    { size: [0.6, 2.0, 0.6], pos: [-8, 2.0, -14], color: 0x7f8c8d },
  ]
  for (const obstacle of obstacles) addStaticBox(ctx, obstacle)

  // Loose crates - the cheapest way to tell whether a collision felt good.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    addDynamicBox(
      ctx,
      {
        size: [0.6, 0.6, 0.6],
        pos: [Math.cos(angle) * 13 - 18, 0.7 + (i % 3) * 1.3, Math.sin(angle) * 13 - 16],
        color: 0xe0b354,
      },
      60,
    )
  }

  // Lighting.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(28, 44, 18)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const shadowRange = 60
  sun.shadow.camera.left = -shadowRange
  sun.shadow.camera.right = shadowRange
  sun.shadow.camera.top = shadowRange
  sun.shadow.camera.bottom = -shadowRange
  sun.shadow.camera.far = 160
  ctx.scene.add(sun)
  ctx.scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x40454d, 1.1))
}
