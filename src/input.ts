import type { Config } from './config'

export interface InputState {
  /** -1..1, smoothed */
  throttle: number
  /** -1..1, smoothed */
  steer: number
  handbrake: boolean
  /** raw targets before smoothing, written by keyboard and touch */
  rawThrottle: number
  rawSteer: number
  resetRequested: boolean
  cameraToggleRequested: boolean
  /** true once a touch has been seen, used to auto-show the on-screen pad */
  touchActive: boolean
}

export function createInputState(): InputState {
  return {
    throttle: 0,
    steer: 0,
    handbrake: false,
    rawThrottle: 0,
    rawSteer: 0,
    resetRequested: false,
    cameraToggleRequested: false,
    touchActive: false,
  }
}

const KEY_THROTTLE_UP = new Set(['KeyW', 'ArrowUp'])
const KEY_THROTTLE_DOWN = new Set(['KeyS', 'ArrowDown'])
const KEY_STEER_LEFT = new Set(['KeyA', 'ArrowLeft'])
const KEY_STEER_RIGHT = new Set(['KeyD', 'ArrowRight'])

export function installKeyboard(state: InputState) {
  const held = new Set<string>()

  const refresh = () => {
    let throttle = 0
    let steer = 0
    for (const code of held) {
      if (KEY_THROTTLE_UP.has(code)) throttle += 1
      if (KEY_THROTTLE_DOWN.has(code)) throttle -= 1
      if (KEY_STEER_LEFT.has(code)) steer -= 1
      if (KEY_STEER_RIGHT.has(code)) steer += 1
    }
    state.rawThrottle = Math.max(-1, Math.min(1, throttle))
    state.rawSteer = Math.max(-1, Math.min(1, steer))
    state.handbrake = held.has('Space')
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return
    if (event.code === 'KeyR') state.resetRequested = true
    if (event.code === 'KeyC') state.cameraToggleRequested = true
    held.add(event.code)
    if (event.code === 'Space') event.preventDefault()
    refresh()
  }
  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.code)
    refresh()
  }
  const onBlur = () => {
    held.clear()
    refresh()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
}

/**
 * On-screen controls: an analog steering pad on the left, throttle/brake and
 * handbrake buttons on the right. Multi-touch is tracked per pointer id so
 * steering and throttle work at the same time.
 */
export function installTouchControls(state: InputState, root: HTMLElement) {
  const steerPad = root.querySelector<HTMLElement>('#steer-pad')!
  const steerKnob = root.querySelector<HTMLElement>('#steer-knob')!
  const buttons = root.querySelectorAll<HTMLElement>('[data-touch-action]')

  // Tracked separately so releasing one pedal doesn't cancel the other.
  const pedals = { throttle: false, brake: false }

  let steerPointer: number | null = null
  let steerOrigin = 0
  let steerRadius = 70

  const setSteer = (value: number) => {
    state.rawSteer = value
    steerKnob.style.transform = `translate(-50%, -50%) translateX(${value * steerRadius}px)`
  }

  steerPad.addEventListener('pointerdown', (event) => {
    state.touchActive = true
    steerPointer = event.pointerId
    capture(steerPad, event.pointerId)
    const rect = steerPad.getBoundingClientRect()
    steerRadius = rect.width * 0.36
    steerOrigin = rect.left + rect.width / 2
    setSteer(clamp((event.clientX - steerOrigin) / steerRadius, -1, 1))
    event.preventDefault()
  })

  steerPad.addEventListener('pointermove', (event) => {
    if (event.pointerId !== steerPointer) return
    setSteer(clamp((event.clientX - steerOrigin) / steerRadius, -1, 1))
    event.preventDefault()
  })

  const releaseSteer = (event: PointerEvent) => {
    if (event.pointerId !== steerPointer) return
    steerPointer = null
    setSteer(0)
  }
  steerPad.addEventListener('pointerup', releaseSteer)
  steerPad.addEventListener('pointercancel', releaseSteer)

  for (const button of buttons) {
    const action = button.dataset.touchAction!
    let pointer: number | null = null

    const press = (event: PointerEvent) => {
      state.touchActive = true
      pointer = event.pointerId
      capture(button, event.pointerId)
      button.classList.add('pressed')
      applyTouchAction(state, pedals, action, true)
      event.preventDefault()
    }
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      pointer = null
      button.classList.remove('pressed')
      applyTouchAction(state, pedals, action, false)
    }

    button.addEventListener('pointerdown', press)
    button.addEventListener('pointerup', release)
    button.addEventListener('pointercancel', release)
  }

  // Stop the page from scrolling or zooming under the controls.
  root.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false })

  window.addEventListener(
    'touchstart',
    () => {
      state.touchActive = true
    },
    { once: true, passive: true },
  )
}

interface Pedals {
  throttle: boolean
  brake: boolean
}

function applyTouchAction(state: InputState, pedals: Pedals, action: string, pressed: boolean) {
  switch (action) {
    case 'throttle':
    case 'brake':
      pedals[action] = pressed
      state.rawThrottle = (pedals.throttle ? 1 : 0) + (pedals.brake ? -1 : 0)
      break
    case 'handbrake':
      state.handbrake = pressed
      break
    case 'reset':
      if (pressed) state.resetRequested = true
      break
    case 'camera':
      if (pressed) state.cameraToggleRequested = true
      break
  }
}

/** Capture is a nicety - a pointer that vanished mid-gesture must not throw. */
function capture(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // The pointer is already gone; the up/cancel handlers still clean up.
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Ease the raw on/off inputs into analog values, at config-driven rates. */
export function smoothInput(state: InputState, cfg: Config, dt: number) {
  const { inputRate, returnRate } = cfg.steering

  const steerRate = Math.sign(state.rawSteer) === -Math.sign(state.steer) || state.rawSteer === 0
    ? returnRate
    : inputRate
  state.steer = approach(state.steer, state.rawSteer, steerRate * dt)

  // Throttle responds immediately; only steering benefits from easing.
  state.throttle = state.rawThrottle
}

function approach(current: number, target: number, maxDelta: number) {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}
