import GUI from 'lil-gui'
import type { Ctx } from './context'
import {
  PRESETS, applyConfig, clearSavedConfig, makeDefaultConfig, saveConfig,
} from './config'
import { applyChassisConfig, resetCar } from './car'

/**
 * Every slider writes straight into the live config object, and the systems read
 * that object each step, so nothing here needs a restart. Only the chassis
 * dimensions and mass properties have to be pushed into Rapier explicitly.
 */
export function buildGui(ctx: Ctx, onTouchControlsChange: () => void) {
  const gui = new GUI({ title: 'Vehicle tuning', width: 300 })
  const cfg = ctx.cfg

  const refreshChassis = () => applyChassisConfig(ctx, ctx.car)
  const refreshAll = () => {
    refreshChassis()
    onTouchControlsChange()
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
  }

  const actions = {
    preset: 'Default',
    resetCar: () => resetCar(ctx, ctx.car),
    save: () => {
      const ok = saveConfig(cfg)
      flash(gui, ok ? 'Saved to this browser' : 'Could not save')
    },
    revert: () => {
      clearSavedConfig()
      applyConfig(cfg, makeDefaultConfig())
      refreshAll()
      flash(gui, 'Reset to defaults')
    },
    copyJson: async () => {
      const json = JSON.stringify(cfg, null, 2)
      try {
        await navigator.clipboard.writeText(json)
        flash(gui, 'Config copied to clipboard')
      } catch {
        // Clipboard needs a secure context; fall back to the console.
        console.log(json)
        flash(gui, 'Clipboard blocked - logged to console')
      }
    },
  }

  gui
    .add(actions, 'preset', Object.keys(PRESETS))
    .name('preset')
    .onChange((name: string) => {
      applyConfig(cfg, PRESETS[name]())
      refreshAll()
    })

  const chassis = gui.addFolder('Chassis')
  chassis.add(cfg.chassis, 'mass', 300, 4000, 10).onChange(refreshChassis)
  chassis.add(cfg.chassis, 'halfWidth', 0.4, 2, 0.05).name('half width').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'halfHeight', 0.15, 1, 0.05).name('half height').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'halfLength', 1, 4, 0.05).name('half length').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'comOffsetY', -2, 1, 0.01).name('COM offset Y').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'comOffsetZ', -1.5, 1.5, 0.01).name('COM offset Z').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'inertiaScale', 0.2, 3, 0.05).name('inertia scale').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'linearDamping', 0, 2, 0.01).name('linear damping').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'angularDamping', 0, 4, 0.01).name('angular damping').onChange(refreshChassis)
  chassis.add(cfg.chassis, 'friction', 0, 2, 0.01).onChange(refreshChassis)
  chassis.add(cfg.chassis, 'restitution', 0, 1, 0.01).onChange(refreshChassis)

  const suspension = gui.addFolder('Suspension')
  suspension.add(cfg.suspension, 'restLength', 0.2, 2, 0.01).name('rest length (m)')
  suspension.add(cfg.suspension, 'originY', -0.5, 0.5, 0.01).name('ray origin Y')
  suspension.add(cfg.suspension, 'stiffness', 0.1, 3, 0.01).name('stiffness (g/corner)')
  suspension.add(cfg.suspension, 'damping', 0, 12, 0.05).name('damping (1/s)')
  suspension.add(cfg.suspension, 'maxForce', 0.5, 12, 0.1).name('max force (g)')
  suspension.add(cfg.suspension, 'spreadX', 0.3, 1.2, 0.01).name('corner spread X')
  suspension.add(cfg.suspension, 'spreadZ', 0.3, 1.2, 0.01).name('corner spread Z')
  suspension.add(cfg.suspension, 'wheelRadius', 0.1, 0.9, 0.01).name('wheel radius').onChange(refreshChassis)

  const drive = gui.addFolder('Drive')
  drive.add(cfg.drive, 'accelForce', 0, 40, 0.5).name('accel (m/s²)')
  drive.add(cfg.drive, 'brakeForce', 0, 40, 0.5).name('brake (m/s²)')
  drive.add(cfg.drive, 'reverseForce', 0, 25, 0.5).name('reverse (m/s²)')
  drive.add(cfg.drive, 'maxSpeed', 5, 90, 1).name('max speed (m/s)')
  drive.add(cfg.drive, 'forceOffsetY', -1.5, 1.5, 0.01).name('force offset Y')
  drive.add(cfg.drive, 'forceOffsetZ', -2, 2, 0.01).name('force offset Z')
  drive.add(cfg.drive, 'rollingResistance', 0, 3, 0.01).name('rolling resist (1/s)')
  drive.add(cfg.drive, 'downforce', 0, 4, 0.05).name('downforce (g)')

  const steering = gui.addFolder('Steering')
  steering.add(cfg.steering, 'torque', 0, 30, 0.1).name('yaw accel (rad/s²)')
  steering.add(cfg.steering, 'rampSpeed', 0.5, 25, 0.5).name('full authority at (m/s)')
  steering.add(cfg.steering, 'highSpeedFalloff', 0, 1, 0.01).name('high speed falloff')
  steering.add(cfg.steering, 'yawDamping', 0, 12, 0.05).name('yaw damping (1/s)')
  steering.add(cfg.steering, 'airControl', 0, 1, 0.01).name('air control')
  steering.add(cfg.steering, 'inputRate', 0.5, 20, 0.1).name('input ramp (1/s)')
  steering.add(cfg.steering, 'returnRate', 0.5, 20, 0.1).name('input return (1/s)')
  steering.add(cfg.steering, 'maxWheelAngle', 5, 60, 1).name('wheel angle (°)')

  const grip = gui.addFolder('Grip')
  grip.add(cfg.grip, 'front', 0, 25, 0.1).name('front (1/s)')
  grip.add(cfg.grip, 'rear', 0, 25, 0.1).name('rear (1/s)')
  grip.add(cfg.grip, 'handbrakeRear', 0, 1, 0.01).name('handbrake rear ×')
  grip.add(cfg.grip, 'handbrakeDriveCut', 0, 1, 0.01).name('handbrake throttle ×')
  grip.add(cfg.grip, 'axleZ', 0.2, 1.2, 0.01).name('axle spread Z')

  const righting = gui.addFolder('Self-righting').close()
  righting.add(cfg.righting, 'torque', 0, 5, 0.05).name('strength (× tip-over)')
  righting.add(cfg.righting, 'damping', 0, 12, 0.05).name('damping (1/s)')
  righting.add(cfg.righting, 'minTilt', 10, 170, 1).name('kicks in past (°)')

  const world = gui.addFolder('World').close()
  world.add(cfg.physics, 'gravity', 1, 60, 0.1).name('gravity (m/s²)')
  world.add(cfg.physics, 'timeScale', 0.05, 2, 0.05).name('time scale')
  world.add(cfg.physics, 'substeps', 1, 6, 1).name('substeps / frame')

  const camera = gui.addFolder('Camera').close()
  camera.add(cfg.camera, 'distance', 3, 25, 0.1)
  camera.add(cfg.camera, 'height', 0.5, 15, 0.1)
  camera.add(cfg.camera, 'lookAhead', -5, 20, 0.1).name('look ahead')
  camera.add(cfg.camera, 'stiffness', 0.5, 25, 0.1)
  camera.add(cfg.camera, 'rotateWithCar', 0, 1, 0.01).name('follow heading')
  camera.add(cfg.camera, 'fov', 30, 110, 1)

  const debug = gui.addFolder('Debug')
  debug.add(cfg.debug, 'suspension').name('suspension rays')
  debug.add(cfg.debug, 'forces').name('force vectors')
  debug.add(cfg.debug, 'contactNormals').name('contact normals')
  debug.add(cfg.debug, 'velocity').name('velocity')
  debug.add(cfg.debug, 'showTouchControls').name('touch controls').onChange(onTouchControlsChange)

  const session = gui.addFolder('Session')
  session.add(actions, 'resetCar').name('reset car (R)')
  session.add(actions, 'save').name('save to browser')
  session.add(actions, 'revert').name('reset to defaults')
  session.add(actions, 'copyJson').name('copy config JSON')

  // Start collapsed on phones, where the panel would cover the whole screen.
  if (window.innerWidth < 720) gui.close()

  return gui
}

let flashTimer: number | undefined
function flash(gui: GUI, message: string) {
  const title = gui.$title
  const original = 'Vehicle tuning'
  title.textContent = message
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    title.textContent = original
  }, 1600)
}
