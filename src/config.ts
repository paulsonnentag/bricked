/**
 * Every number that affects how the car feels lives here.
 *
 * Forces are expressed in mass-relative units (accelerations, g's, 1/s rates)
 * rather than newtons, and torques relative to the chassis inertia. That way
 * changing the mass or the size of the car doesn't silently retune everything
 * else, and the sliders keep meaning the same thing.
 */

export type Config = ReturnType<typeof makeDefaultConfig>

export function makeDefaultConfig() {
  return {
    physics: {
      /** m/s^2, positive number, applied downwards */
      gravity: 19.6,
      /** how many 1/120s physics steps per frame budget */
      substeps: 2,
      timeScale: 1,
    },

    chassis: {
      mass: 1200,
      halfWidth: 0.9,
      halfHeight: 0.3,
      halfLength: 1.9,
      /** the "heavy bottom punching bag" hack - negative is below the box */
      comOffsetY: -0.45,
      /** positive is towards the front */
      comOffsetZ: 0.0,
      /** fudge factor on the box inertia tensor: lower = flicks around faster */
      inertiaScale: 0.8,
      linearDamping: 0.05,
      angularDamping: 0.4,
      friction: 0.4,
      restitution: 0.15,
    },

    suspension: {
      /** raycast length, in metres */
      restLength: 0.85,
      /** local Y the rays start from */
      originY: 0.05,
      /** g's of push per corner at full compression. rest height = 1/(4*stiffness) */
      stiffness: 0.62,
      /** 1/s - resists the corner moving along the car's up axis */
      damping: 3.2,
      /** hard cap per corner, in g's */
      maxForce: 4.0,
      /** corner placement as a fraction of the chassis half-extents */
      spreadX: 0.95,
      spreadZ: 0.78,
      wheelRadius: 0.35,
      wheelWidth: 0.25,
    },

    drive: {
      /** m/s^2 of forward push at full throttle */
      accelForce: 14,
      /** m/s^2 of retardation when throttle opposes travel */
      brakeForce: 18,
      /** m/s^2 when reversing */
      reverseForce: 7,
      /** m/s the forward push fades out at (~110 km/h at 30) */
      maxSpeed: 34,
      /** apply drive force below the COM to pitch the car on accel/brake */
      forceOffsetY: -0.35,
      forceOffsetZ: 0.6,
      /** 1/s drag along the travel direction while grounded */
      rollingResistance: 0.35,
      /** g's of extra downward push at max speed */
      downforce: 0.5,
    },

    steering: {
      /** rad/s^2 of yaw acceleration at full lock */
      torque: 9.0,
      /** m/s at which full steering authority is reached */
      rampSpeed: 6,
      /** 0..1 - how much authority is lost at max speed */
      highSpeedFalloff: 0.55,
      /** 1/s counter-torque that stops the car spinning forever */
      yawDamping: 3.0,
      /** fraction of steering authority retained in mid air */
      airControl: 0.35,
      /** how fast keyboard/touch steer input ramps to full lock, units/s */
      inputRate: 3.6,
      /** how fast it snaps back to centre, units/s */
      returnRate: 6.0,
      /** visual only: max front wheel deflection, degrees */
      maxWheelAngle: 32,
    },

    grip: {
      /** 1/s - how aggressively sideways velocity is cancelled at the front axle */
      front: 9.0,
      /** ... and the rear. front > rear = oversteer, front < rear = understeer */
      rear: 8.0,
      /** rear grip multiplier while the handbrake is held */
      handbrakeRear: 0.18,
      /** throttle multiplier while the handbrake is held */
      handbrakeDriveCut: 0.4,
      /** axle placement as a fraction of the chassis half-length */
      axleZ: 0.78,
    },

    righting: {
      /**
       * Multiples of the torque needed to just tip the car off its side edge.
       * Below 1 it can't lift itself at all; much above it and the car flips
       * violently, so this is the number to nudge rather than guess at.
       */
      torque: 1.4,
      /** rad/s^2 of damping per rad/s about the righting axis, stops tumbling */
      damping: 3.0,
      /** only kicks in once the up axis is tilted more than this, degrees */
      minTilt: 55,
    },

    camera: {
      distance: 9,
      height: 3.6,
      lookAhead: 5,
      /** 1/s - higher snaps to the car faster */
      stiffness: 4.5,
      /** how much the camera follows the car's yaw, 0 = fixed heading */
      rotateWithCar: 1,
      fov: 62,
    },

    debug: {
      suspension: true,
      forces: false,
      velocity: false,
      contactNormals: false,
      showTouchControls: false,
    },
  }
}

export const PRESETS: Record<string, () => Config> = {
  Default: makeDefaultConfig,

  Grippy: () => {
    const c = makeDefaultConfig()
    c.grip.front = 14
    c.grip.rear = 14
    c.suspension.stiffness = 0.8
    c.suspension.damping = 4.5
    c.steering.torque = 11
    c.steering.yawDamping = 4.5
    c.drive.accelForce = 16
    c.chassis.comOffsetY = -0.3
    return c
  },

  Drifty: () => {
    const c = makeDefaultConfig()
    c.grip.front = 9
    c.grip.rear = 3.2
    c.steering.torque = 12
    c.steering.yawDamping = 1.6
    c.steering.highSpeedFalloff = 0.25
    c.drive.accelForce = 17
    c.drive.rollingResistance = 0.2
    return c
  },

  Floaty: () => {
    const c = makeDefaultConfig()
    c.physics.gravity = 12
    c.suspension.stiffness = 0.45
    c.suspension.damping = 1.6
    c.suspension.restLength = 1.1
    c.chassis.angularDamping = 0.2
    c.grip.front = 5
    c.grip.rear = 4.5
    c.drive.accelForce = 11
    return c
  },

  Heavy: () => {
    const c = makeDefaultConfig()
    c.chassis.mass = 2400
    c.chassis.inertiaScale = 1.3
    c.suspension.stiffness = 0.7
    c.suspension.damping = 4
    c.steering.torque = 5.5
    c.steering.rampSpeed = 9
    c.drive.accelForce = 9
    c.drive.brakeForce = 12
    c.grip.front = 7
    c.grip.rear = 7
    return c
  },
}

const STORAGE_KEY = 'bricked.vehicle.config.v1'

/** Copy src over dst in place, so live references held by systems stay valid. */
export function applyConfig(dst: Config, src: unknown) {
  if (typeof src !== 'object' || src === null) return
  for (const key of Object.keys(dst) as (keyof Config)[]) {
    const group = (src as Record<string, unknown>)[key]
    if (typeof group !== 'object' || group === null) continue
    const target = dst[key] as Record<string, unknown>
    for (const field of Object.keys(target)) {
      const value = (group as Record<string, unknown>)[field]
      if (typeof value === typeof target[field]) target[field] = value
    }
  }
}

export function saveConfig(config: Config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    return true
  } catch {
    return false
  }
}

export function loadSavedConfig(): unknown | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearSavedConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore - private browsing
  }
}
