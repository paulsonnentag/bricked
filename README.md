# bricked

An arcade vehicle physics prototype, built to tune how a car *feels* rather than
to simulate one accurately. It follows the approach Michael Davies described for
Space Dust Racing: a single rigid box for collision, four raycast suspension
springs, and forces and torques for drive, steering and grip — no wheel colliders,
no drivetrain, no tyre model.

Every number that affects the feel is a live slider. Nothing needs a reload.

**Play it: https://paulsonnentag.github.io/bricked/**

The page goes live once GitHub Pages is switched on for this repository:
**Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.

The repository does not have to be public. A Pages site's visibility is a
separate setting from the repository's, so a private repo can publish a
publicly reachable site while the source stays private. Publishing Pages from a
private repository does require GitHub Pro (or Team/Enterprise) - on the free
plan Pages only works from public repositories. Restricting the site itself to
people with repo access is an Enterprise Cloud feature.

```bash
npm install
npm run dev
```

Pushing to `main` rebuilds and redeploys the page via GitHub Actions
(`.github/workflows/deploy.yml`). The build uses a relative asset base, so it
works from the `/bricked/` project subpath without hardcoding the repo name.

## Stack

| Piece | Role |
| --- | --- |
| [Rapier](https://rapier.rs) | rigid bodies, collisions, raycasts |
| [three.js](https://threejs.org) | rendering only |
| [bitECS](https://github.com/NateTheGreatt/bitECS) | entity storage, systems pipeline |
| [lil-gui](https://lil-gui.georgealways.com) | the tuning panel |

## Controls

Keyboard: **WASD** / arrows to drive, **space** handbrake, **R** reset, **C** toggle
whether the camera follows the car's heading.

On touch devices an on-screen pad appears automatically: analog steering on the
left, gas / brake / handbrake on the right, reset and camera top-left. You can
force it on from the Debug folder of the panel.

## How the car works

Each fixed step, in order:

1. **Clear forces.** Rapier's force accumulator survives `step()`, so it has to be
   reset or everything compounds and the car launches into orbit.
2. **Suspension.** Four rays cast down the car's local down axis from the chassis
   corners, `restLength` long. A hit gives a compression ratio between 0 (fully
   extended) and 1 (bottomed out). Each corner pushes up with
   `stiffness × compression − damping × cornerUpSpeed`, applied at the corner, so
   the car pitches and rolls the way the load does. The hit point, normal and
   compression are cached for everything downstream.
3. **Drive.** Throttle pushes along the car's forward axis *projected onto the
   ground plane*, so it never digs in or takes off when pitched. It's applied
   below and ahead of the centre of mass, which is what makes the car squat under
   power and dive under brakes. Scaled by how many wheels are actually down.
4. **Steering.** A yaw torque, never a direct rotation — so hitting a wall
   mid-corner pushes back instead of glitching through. Authority ramps up with
   speed, falls off again near top speed, and drops to `airControl` in the air.
5. **Grip.** The sideways component of velocity is cancelled by an opposing force,
   applied separately at the front and rear axles. The balance between the two is
   the understeer/oversteer knob; the handbrake just multiplies the rear one down.
6. **Self-righting.** Optional torque that rolls the car back onto its wheels once
   it's tipped past a threshold.

The chassis is one box collider. The wheels are cosmetic — they hang at whatever
depth the suspension raycast found, steer with the input, and roll at the car's
actual speed.

## Tuning

Units are deliberately mass-relative, so changing the car's mass or size doesn't
silently retune everything else:

- **accel / brake / reverse** are in m/s², not newtons.
- **suspension stiffness** is in g's per corner at full compression. Resting
  compression works out to `1 / (4 × stiffness)` — at 0.62 the car sits at about
  40% compressed, which is where you want it so it has room to both compress and
  extend.
- **steering torque** is a yaw acceleration in rad/s², scaled by the chassis
  inertia.
- **grip** is a rate in 1/s: how fast sideways velocity gets cancelled.
- **self-righting strength** is a multiple of the torque needed to just tip the
  car off its side edge — below 1 it can't lift itself at all.

Some places to start:

- **Understeer / oversteer** — `grip.front` vs `grip.rear`. Equal is neutral;
  rear lower slides the back out.
- **Bounciness** — `suspension.stiffness` up and `damping` down for a floaty
  buggy; both up for something stiff and planted.
- **Rolls over too easily** — drop `chassis.comOffsetY` further below the box.
  This is a fudge, not physics: it makes the car behave like a weighted punching
  bag that wants to land on its wheels.
- **Turns like a boat** — raise `steering.torque`, lower `steering.rampSpeed`, and
  check `steering.highSpeedFalloff` isn't eating all the authority.
- **Feels sluggish overall** — raise `physics.gravity`. It defaults to 2g, which
  is standard for arcade handling; everything gets snappier without changing the
  car.

The **Debug** folder draws the suspension rays, per-corner spring forces, drive
and grip vectors, contact normals and the centre of mass, which is usually faster
than guessing at why something feels wrong.

Presets (Default / Grippy / Drifty / Heavy / Floaty) are starting points, not
destinations. **Save to browser** persists your config to localStorage and it
reloads automatically; **copy config JSON** puts the whole thing on the clipboard
so a setup you like can be pasted into `src/config.ts`.

The simulation is also reachable from the browser console:

```js
vehicle.cfg.grip.rear = 3
vehicle.apply()          // needed only after chassis mass/size/COM changes
vehicle.usePreset('Drifty')
```

## The world

Flat floor, four ramps at different gradients, a few walls and pillars, and a
scatter of loose crates — just enough to test landings, glancing hits and
collisions. It is not a track.

## Layout

```
src/
  config.ts            every tunable parameter, plus presets
  car.ts               chassis body, collider, wheels
  world.ts             floor, ramps, obstacles
  input.ts             keyboard and touch
  gui.ts               tuning panel
  debug.ts, hud.ts     overlays
  ecs/
    components.ts      SoA component arrays
    systems/
      vehicle.ts       suspension, drive, steering, grip, righting
      physics.ts       fixed step, Rapier to Transform
      render.ts        interpolation, wheels, camera
      debug.ts         debug line drawing
  main.ts              fixed-step loop
```

Physics runs on a fixed step (60 Hz × `substeps`) with an accumulator; rendering
interpolates between the last two states, so frame rate never changes how the car
behaves.
