# Rattleworks combat regression harness

This isolated browser harness imports the production `PhysicsWorld` and
`ParticleSystem`. It does not modify saves, game state, or production source.

## Run

From the repository root:

```powershell
npm run dev -- --host 127.0.0.1 --port 4174
```

Then open:

```text
http://127.0.0.1:4174/work/combat-tests/harness.html
```

The page runs automatically. Its root element ends with
`data-test-status="pass"`, `"fail"`, or `"error"`. The structured result is
also exposed as `window.__RATTLEWORKS_COMBAT_REGRESSION__`.

Strict compile check:

```powershell
npx tsc -p work/combat-tests/tsconfig.json --pretty false
```

## Coverage

- Seven physical weapon kinds and the ammo box spawn with finite bodies,
  owning colliders, CCD/state invariants, and zero joints.
- Pistol, shotgun, and rifle use exact screen-to-world targets, damage a
  character through the production raycast, consume ammunition, report empty,
  and reload from reserve.
- Campaign pistol, shotgun, and rifle cards use the same damage rays directly
  from the aimed screen point without creating any firearm body or collider.
- A close shotgun blast intersects multiple character colliders while emitting
  no more than one hit/defeat callback per character for one trigger.
- Knife, machete, axe, and spear deliberate use plus a physical axe collision
  damage characters through both melee paths.
- Sixty rifle shots and sixteen high-speed melee impacts keep recoil, global
  speeds, transforms, and physics bookkeeping bounded and finite.
- Render-only gore saturates at every high-quality cap, settles into capped
  pools, trims immediately on a quality downgrade, clears completely, and does
  not create bodies, colliders, or joints.
