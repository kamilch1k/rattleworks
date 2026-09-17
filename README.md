# Rattleworks

Rattleworks is a complete, original 3D browser physics-destruction game built for quick sessions on desktop and mobile. The campaign offers twelve handcrafted levels across three chapters; the same simulation systems power an unrestricted sandbox with ragdolls, machines, connectors, saves, blueprints, undo, and redo.

No third-party game art, audio, character designs, or copyrighted assets are used. Visuals combine reusable Three.js geometry, CSS, and four original generated character-material textures bundled locally; sound is synthesized at runtime with Web Audio.

## Run locally

Requirements: Node.js 20 or newer and a modern browser with WebAssembly and WebGL 2.

```bash
npm install
npm run dev
```

Open the local URL Vite prints. The first load includes the Rapier WebAssembly module; subsequent loads are browser-cached.

## Production build

```bash
npm run build
```

The deployable static game is written to `dist/`. To check that build locally:

```bash
npm run preview
```

The project uses a relative Vite base, so the production build can be served from a portal subdirectory as well as a domain root.

## Controls

### Desktop

- Left click: select an object or body part
- Left drag: physically grab an object or individual ragdoll part
- Shift + click: multi-select
- Right drag: orbit the camera
- Middle drag or Shift + drag: pan
- Mouse wheel: zoom
- WASD: move the camera focus
- Q / E: lower or raise the camera focus
- F: fire or place the selected campaign item
- Space: pause / resume
- Delete: remove the sandbox selection
- Ctrl/Cmd + Z: undo
- Ctrl/Cmd + Shift + Z: redo
- Ctrl/Cmd + R: reset the current attempt
- F3: toggle the hidden performance lab

### Touch

- Tap: select or use the active tool
- Drag: physically grab
- While aiming: the first tap previews the shot, then the big LAUNCH button fires (aim cancel button and Esc lower the shot)
- Two-finger drag/pinch: orbit and zoom
- All essential actions use large on-screen controls

## Game flow

- **Campaign:** 12 levels, limited loadouts, live/build phases, friendly-survival rules, three-star challenges, progression, unlocks, instant retry, and a projectile-follow camera.
- **Sandbox:** searchable categorized spawn browser, characters, structures, props, machines, destruction toys, physical grab, freeze/unfreeze, rotate, push, blast, weld, rope, spring, hinge, motor, duplicate, multi-select, undo/redo, slow motion, local world saves, and reusable blueprints.
- **Settings:** Low/Medium/High presets tune body limits, solver work, particles, shadows, and render scale. Volume and camera shake are saved.

## Roadmap / TODO

All remaining work lives here. Items are ordered by impact for the CrazyGames
and Yandex Games audiences. The first-minute pass shipped: predicted-shot aim
guide, CONTINUE quick play, floating damage/kill popups, kill combos, hit-stop
on kills and explosions, post-level camera orbit, and touch tap-to-confirm
aiming with thumb-sized campaign controls.

### Campaign & feel

- [ ] Aim-guide readability: the predicted arc currently reads as a short
      vertical dotted trail because shots launch from behind the camera.
      Consider a lateral launch offset for the guide, a projected ground path,
      or a farther-out arc so the parabola is legible at a glance.
- [ ] Localization: extract user-facing strings and add de/fr/es/pt through the
      RussianLocale pipeline; auto-select the language on CrazyGames the way
      Yandex already does.
- [ ] More content: add a 4th chapter (levels 13-16) using the data-only level
      authoring flow; then a seeded Daily Rattle (one shared layout per UTC day,
      one attempt, portal leaderboard score via `submitScore`).

### Monetization (portal-ready)

- [ ] Interstitial ad on the level-complete boundary, frequency-capped
      (>= 90 s since the last one, never the first level, never mid-attempt).
- [ ] Rewarded "Continue" on failure (one revive per attempt) and/or
      "Extra shot" as a rewarded offer; never during an active attempt.
- [ ] Document ad behavior here; keep Local builds and QA routes a strict no-op.

### Sandbox & sharing

- [ ] Sandbox polish pass (the menu still labels it WIP).
- [ ] Blueprint sharing: encode/decode blueprints to a compact string with
      copy/paste import; validate size and entity caps on import.

### Performance (mobile-first)

- [ ] Remove per-frame allocations in PhysicsWorld contact handling,
      CameraController.update, GoreEffects bursts, and ParticleSystem.
- [ ] Consolidate GoreEffects droplets/splats into instanced or point-sprite
      rendering; record F3 draw calls on `?qa=1&stress=props` and
      `?qa=1&stress=ragdolls` before and after.
- [ ] Quality autodetect on first run (renderer string plus device hints);
      the low preset should also skip antialiasing; never override an explicit
      player choice.
- [ ] Frontline prototype fixes: cache HUD refs (per-frame `querySelector`),
      remove per-frame `Vector3` allocations, count melee kills, and move squad
      deployment off `setTimeout` into the update loop.

### Backbone

- [ ] `npm test`: type-check plus the deterministic physics/level harnesses in
      `work/*-tests`; run tests and all three builds in GitHub Actions on push.
- [ ] Dead-code cleanup: `Game.startMachine` and the unreachable build-phase
      branches, `types.ts` `'live' | 'build'`, the WorldTheme double ground-map
      load and duplicated instance helpers, the CharacterVisuals dead branch and
      missing dispose path, `GoreEffects` dead `TextureSlot.failed`, and the
      duplicated `styles.css` override block.
- [ ] Decision: Frontline mode — polish it into an unlockable bonus mode
      reachable from the campaign-complete screen, or remove it from the repo.

## Architecture

The game favors composition and data over one large class per prop:

- `src/game/Game.ts` — main flow, renderer orchestration, campaign/sandbox UI, scoring, level loading, snapshots, undo/redo, and browser lifecycle
- `src/game/PhysicsWorld.ts` — Rapier world, material registry, reusable entity spawning, full multi-body ragdolls, damage, destruction, connectors, explosions, machines, and fixed-timestep simulation
- `src/game/CharacterVisuals.ts` — textured, variant-specific render geometry and clothing layered over unchanged ragdoll colliders
- `src/game/CameraController.ts` — orbit/pan/zoom, keyboard movement, focus, projectile follow/return, and shake
- `src/game/SelectionSystem.ts` — ray picking, multi-selection, physics-spring grabbing, and connector interaction
- `src/game/ParticleSystem.ts` — pooled dust, sparks, explosion cubes, and harmless character juice
- `src/game/AudioSystem.ts` — original procedural Web Audio effects with pitch variation
- `src/game/levels.ts` — all data-driven campaign definitions and reusable authoring prefabs
- `src/game/SaveSystem.ts` — versioned local persistence, normalization, and migration-safe defaults
- `src/game/PlatformService.ts` — safe Local, CrazyGames, and Yandex Games adapters
- `src/game/types.ts` — shared data contracts for levels, entities, characters, saves, worlds, and blueprints
- `src/styles.css` — complete responsive game UI and visual identity

The physics world advances at a fixed 60 Hz step with capped catch-up, sleeping bodies, selective CCD, velocity clamps, finite-transform protection, shared geometry/materials, pooled particles, and quality-dependent solver/body limits.

## Add a prop

1. Add its default size, physical material, color, and shape to `PhysicsWorld.defaults()`.
2. If it has behavior, add a small composition flag or a branch in `updateMachines()` instead of creating a large subclass.
3. Add it to `CATALOG` in `Game.ts` if it should appear in Sandbox.
4. Optionally add display metadata to `ITEM_INFO` if campaign levels can place or launch it.

Level definitions may also use explicit `scale`, `material`, `color`, `fixed`, and `group` values to override registry defaults.

## Add a character

1. Extend `CharacterKind` in `types.ts`.
2. Add a palette and physical profile in `PhysicsWorld.spawnCharacter()`.
3. Add its display name pool and optional head accessory.
4. Add a Sandbox catalog entry.

Every character is assembled from ten independent Rapier bodies: head, torso, two upper arms, two lower arms, two upper legs, and two lower legs. Spherical joints connect the parts. Sleeping starts them in a stable toy pose; impacts wake the linked ragdoll naturally.

## Create a campaign level

Add a `LevelDefinition` to `LEVELS` in `src/game/levels.ts`. A definition contains:

- id, chapter, name, subtitle, description, environment, and live/build phase
- object/character spawn definitions
- a limited loadout and allowed tools
- two additional star rules
- starting camera position and focus
- a short visual hint and sandbox unlock reward

The loader, objective tracking, scoring, progression, reset, UI, and save flow require no gameplay-class changes. Level 13 is primarily a new data entry.

## Create a prefab

Use the helpers in `levels.ts` as patterns: `house`, `frameBuilding`, `tower`, `blockWall`, `bridge`, `springRange`, `wreckingRig`, `castle`, `conveyorLine`, `factory`, `deliveryFort`, and `finalArena`.

Pieces sharing a `group` are automatically given nearby structural welds. Group names containing `rope` or `weight` create a flexible hanging connection. Runtime destruction removes connections with broken pieces; no expensive mesh fracturing is used.

## Saves and blueprints

`SaveSystem` stores a normalized `saveVersion: 1` document in localStorage and safely falls back to memory if storage is unavailable. It saves campaign results, stars, unlocks, settings, favorites, recents, Sandbox worlds, and blueprints.

Blueprints use a portable relative-transform format containing object types, transforms, colors, materials, fixed state, and connector indices. The format is ready to be encoded or sent to a backend later without changing the physics model.

## CrazyGames deployment

1. Run `npm run build`.
2. Zip the **contents** of `dist/`, with `index.html` at the archive root.
3. Upload the archive in the CrazyGames developer portal.
4. Test loading, fullscreen/resizing, mobile input, audio unlock, focus/visibility pause, and ad callbacks in the portal preview.

`CrazyGamesPlatform` auto-detects the SDK. It reports loading/gameplay lifecycle events, offers natural interstitial/rewarded hooks, mirrors save data locally, and remains a safe no-op when an SDK method is unavailable. The game never requests an ad during an active attempt.

## Yandex Games deployment

1. Run `npm run build`.
2. Zip the **contents** of `dist/`, keeping `index.html` at the root.
3. Create/update the game in the Yandex Games console and upload the archive.
4. Test the English build, mobile orientation/resizing, sound unlock, visibility lifecycle, player storage, and ad callbacks in draft mode.

`YandexGamesPlatform` auto-detects `YaGames`, initializes safely, calls readiness/gameplay hooks when supported, and provides player-data/ad/leaderboard extension points. Missing SDKs never crash local or portal-preview gameplay.

## Platform adapter contract

All adapters expose:

- `initialize`, `loadingComplete`, `gameplayStart`, `gameplayStop`, and `happyTime`
- `showInterstitial` and `showRewarded`
- `saveData` and `loadData`
- `submitScore` and `getPlayer`
- browser visibility/page lifecycle binding

`platformService` automatically chooses CrazyGames, Yandex, or the local fallback at runtime.

## Browser QA

The production UI hides diagnostics. On localhost only, `?qa=1&level=12` can load a locked level directly for authoring checks. `?qa=1&stress=ragdolls` runs 20 active ragdolls, while `?qa=1&stress=props` runs 100 active props. These routes do not bypass progression on hosted builds.
