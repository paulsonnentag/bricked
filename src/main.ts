import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { createWorld } from 'bitecs'
import { PRESETS, applyConfig, loadSavedConfig, makeDefaultConfig } from './config'
import { createInputState, installKeyboard, installTouchControls, smoothInput } from './input'
import { DebugLines } from './debug'
import { Hud } from './hud'
import { buildGui } from './gui'
import { buildWorld } from './world'
import { applyChassisConfig, createCar, resetCar } from './car'
import * as components from './ecs/components'
import { CarInput, bodies, colliders } from './ecs/components'
import type { Ctx } from './context'
import { physicsStepSystem, syncTransformSystem } from './ecs/systems/physics'
import {
  clearForcesSystem, driveSystem, gripSystem, rightingSystem, steeringSystem, suspensionSystem,
} from './ecs/systems/vehicle'
import {
  cameraSystem, interpolateTransformSystem, visualSteerSystem, wheelVisualSystem,
} from './ecs/systems/render'
import { debugDrawSystem } from './ecs/systems/debug'

/** Physics runs at this rate times the substep count. */
const BASE_STEP = 1 / 60
/** Cap on catch-up steps, so a background tab doesn't stall on resume. */
const MAX_STEPS_PER_FRAME = 8

async function boot() {
  await RAPIER.init()

  const cfg = makeDefaultConfig()
  const saved = loadSavedConfig()
  if (saved) applyConfig(cfg, saved)

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  document.body.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x141922)
  scene.fog = new THREE.Fog(0x141922, 70, 160)

  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, window.innerWidth / window.innerHeight, 0.1, 400)
  camera.position.set(0, 6, -24)

  const debug = new DebugLines()
  scene.add(debug.object)

  const input = createInputState()
  installKeyboard(input)

  const ctx: Ctx = {
    ecs: createWorld(),
    physics: new RAPIER.World({ x: 0, y: -cfg.physics.gravity, z: 0 }),
    rapier: RAPIER,
    scene,
    camera,
    renderer,
    cfg,
    input,
    debug,
    car: 0,
    dt: BASE_STEP,
  }

  buildWorld(ctx)
  ctx.car = createCar(ctx)

  const touchRoot = document.getElementById('touch-controls')!
  installTouchControls(input, touchRoot)

  const help = document.getElementById('help')!
  let touchVisible: boolean | null = null
  const updateTouchVisibility = () => {
    const shouldShow = cfg.debug.showTouchControls || input.touchActive
    if (shouldShow === touchVisible) return
    touchVisible = shouldShow
    touchRoot.classList.toggle('visible', shouldShow)
    help.classList.toggle('hidden', shouldShow)
  }

  // Phones and tablets get the pad up front rather than after the first tap.
  if (window.matchMedia('(pointer: coarse)').matches) cfg.debug.showTouchControls = true

  const gui = buildGui(ctx, updateTouchVisibility)
  updateTouchVisibility()

  const hud = new Hud(document.getElementById('hud')!)

  // Everything needed to poke at the simulation from the browser console, e.g.
  //   vehicle.cfg.grip.rear = 3; vehicle.apply()
  ;(window as unknown as { vehicle: unknown }).vehicle = {
    ctx,
    cfg,
    components,
    bodies,
    colliders,
    presets: PRESETS,
    get carBody() {
      return bodies[ctx.car]
    },
    /** push config changes that Rapier needs told about, then refresh the GUI */
    apply: () => {
      applyChassisConfig(ctx, ctx.car)
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
    },
    usePreset: (name: keyof typeof PRESETS) => {
      applyConfig(cfg, PRESETS[name]())
      applyChassisConfig(ctx, ctx.car)
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
    },
    reset: () => resetCar(ctx, ctx.car),
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  const fixedUpdate = (dt: number) => {
    ctx.dt = dt
    smoothInput(input, cfg, dt)

    CarInput.throttle[ctx.car] = input.throttle
    CarInput.steer[ctx.car] = input.steer
    CarInput.handbrake[ctx.car] = input.handbrake ? 1 : 0

    clearForcesSystem(ctx)
    suspensionSystem(ctx)
    driveSystem(ctx)
    steeringSystem(ctx)
    gripSystem(ctx)
    rightingSystem(ctx)

    physicsStepSystem(ctx)
    syncTransformSystem(ctx)
  }

  let accumulator = 0
  let last = performance.now()

  const frame = (now: number) => {
    requestAnimationFrame(frame)

    // Clamp so a long stall (alt-tab, GUI drag) doesn't teleport the car.
    const frameDt = Math.min((now - last) / 1000, 0.25)
    last = now

    if (input.resetRequested) {
      input.resetRequested = false
      resetCar(ctx, ctx.car)
    }
    if (input.cameraToggleRequested) {
      input.cameraToggleRequested = false
      cfg.camera.rotateWithCar = cfg.camera.rotateWithCar > 0.5 ? 0 : 1
    }
    updateTouchVisibility()

    const stepDt = BASE_STEP / cfg.physics.substeps
    accumulator += frameDt * cfg.physics.timeScale

    let steps = 0
    while (accumulator >= stepDt && steps < MAX_STEPS_PER_FRAME) {
      fixedUpdate(stepDt)
      accumulator -= stepDt
      steps++
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0

    const alpha = THREE.MathUtils.clamp(accumulator / stepDt, 0, 1)
    interpolateTransformSystem(ctx, alpha)
    visualSteerSystem(ctx, frameDt)
    wheelVisualSystem(ctx, frameDt)
    cameraSystem(ctx, frameDt)
    debugDrawSystem(ctx)
    hud.update(ctx, frameDt)

    renderer.render(scene, camera)
  }

  document.getElementById('loading')!.classList.add('hidden')
  requestAnimationFrame(frame)
}

boot().catch((error) => {
  console.error(error)
  const loading = document.getElementById('loading')
  if (loading) loading.textContent = `failed to start: ${error}`
})
