# Rattleworks physics regression harness

This is an isolated browser harness. It imports the real `PhysicsWorld` and
`SelectionSystem` classes, but it does not modify game source, saves, or the
production build.

## Run

From the repository root:

```powershell
npm run dev -- --host 127.0.0.1 --port 4174
```

Then open:

```text
http://127.0.0.1:4174/work/physics-tests/harness.html
```

The page runs automatically and prints JSON. Its root element ends with
`data-test-status="pass"` or `data-test-status="fail"`, and the same report is
available as `window.__RATTLEWORKS_PHYSICS_REGRESSION__` for browser runners.

By default, the stress scenarios advance 600 fixed physics steps while yielding
to the browser periodically. Focused invariant scenarios use a shorter fixed
window. Use `?realtime=1` to pace every step at approximately 60 Hz. The
settling thresholds are calibrated for the default 10-second run.

## Coverage

- Loose 4x3 block wall settling and push response with zero implicit connectors
- Connector cycle rejection across ordinary props, one ragdoll, and a prop linked to two limbs
- Arbitrarily rotated hinge/motor creation with bounded first-step correction
- Invalid, negative, zero, and too-short rope rest lengths without creation snap
- `simulationScale` transitions through `0.18 -> 1 -> 0.32 -> 1` while the solver remains at `1/60`
- Every authored campaign level spawned and idled for five seconds with only rope/weight groups connected
- Zero spontaneous authored explosive removals or explosion callbacks during idle level checks
- Held low-mass ragdoll limb at an off-center surface point for 10 seconds
  through the production grab controller and controlled-mass calculation
- Exact compound-ragdoll anatomy: 10 bodies, 14 body colliders, and 9 limited
  motorized joints, with real hand/foot collider ownership and survival checks
- Non-adjacent ragdoll self-contact without self-damage callbacks, plus bounded
  joint angles, coherent anchors, and late-window motor settling
- Rotated fixed-weld creation with first-step snap and sustained drift limits
- Mass-normalized push delta-v comparison across a 10x body-mass ratio
- Explosion recursion/deletion bookkeeping and one damage event per character
- Finite, non-recursive debris with spawn separation and motion bounds
- 20 ragdolls / 200 tracked parts / 280 body colliders / 180 joints for 10 seconds
- 100-prop stress layout for 10 seconds
- NaN/Infinity and invalid-body detection on every frame
- Linear and angular velocity caps on every frame
- Rapier body/collider counts vs. game entity bookkeeping, including four
  compound extremity colliders per live character
- Exact ragdoll joint counts and zero prop joints
- Bounded coordinates and late-window settling/jitter thresholds

The thresholds are intentionally explicit in `physics-regression.ts`, so a
physics tuning change can update them in review instead of silently weakening
the check.
