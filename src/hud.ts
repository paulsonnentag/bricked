import { Car, CORNERS, Suspension } from './ecs/components'
import type { Ctx } from './context'

export class Hud {
  private element: HTMLElement
  private accumulator = 0
  private fpsFrames = 0
  private fps = 0

  constructor(element: HTMLElement) {
    this.element = element
  }

  update(ctx: Ctx, frameDt: number) {
    this.accumulator += frameDt
    this.fpsFrames++
    if (this.accumulator >= 0.25) {
      this.fps = this.fpsFrames / this.accumulator
      this.accumulator = 0
      this.fpsFrames = 0
    }

    const eid = ctx.car
    const speed = Car.forwardSpeed[eid]
    const lateral = Car.lateralSpeed[eid]
    const grounded = Car.groundedCount[eid]

    // Slip angle: how far the car's travel differs from where it points.
    const slip = (Math.atan2(lateral, Math.abs(speed) + 1e-3) * 180) / Math.PI

    const bars: string[] = []
    for (let corner = 0; corner < CORNERS; corner++) {
      const compression = Suspension.compression[eid * CORNERS + corner]
      bars.push(compressionBar(compression))
    }

    this.element.textContent = [
      `${(Math.abs(speed) * 3.6).toFixed(0).padStart(3)} km/h${speed < -0.5 ? ' (rev)' : ''}`,
      `slip  ${slip.toFixed(0).padStart(4)}°`,
      `wheels ${grounded}/4`,
      `FL ${bars[0]}  FR ${bars[1]}`,
      `RL ${bars[2]}  RR ${bars[3]}`,
      `${this.fps.toFixed(0)} fps`,
    ].join('\n')
  }
}

const BAR_WIDTH = 10
function compressionBar(compression: number) {
  const filled = Math.round(Math.max(0, Math.min(1, compression)) * BAR_WIDTH)
  return '█'.repeat(filled) + '·'.repeat(BAR_WIDTH - filled)
}
