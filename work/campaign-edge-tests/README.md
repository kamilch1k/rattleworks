# Campaign edge regression

This focused browser harness exercises the actual `Game` runtime and HUD for six campaign fixes:

1. Picking a campaign loadout card clears selected/armed physical-weapon intent.
2. Campaign undo/redo restores both world state and loadout counts (including HUD text).
3. Sandbox catalog locks honor both explicit `unlockedItems` rewards and `lockedAfter` completion stages.
4. Every campaign level starts launch-ready, exposes Grab, omits the redundant SHOT header, and keeps the equipped shot armed after firing.
5. Rewards only flow forward through campaign progression. Concrete, bombs, blades, firearms, rockets, Tank Shells, and the rest of the earned combat kit all use the world-point reticle; depleted cards select and arm the next aimed ability, while Level 1 stays a four-ball starter kit with no Ammo Box.
6. Campaign damage uses transparent white text and enemy defeats use a large transparent red cumulative kill label.
7. Living campaign targets share one textureless white triangle marker; friendlies are excluded, defeated markers disappear, and defeated faces stay hidden while their ragdoll bodies remain physical.

The harness snapshots and restores the normal save around the run. It is intended for localhost QA because direct access to locked build levels is enabled only by the local `?qa` flag.

Run strict TypeScript validation:

```powershell
npx.cmd tsc -p work/campaign-edge-tests/tsconfig.json --pretty false
```

Serve the repository with Vite, then open:

```text
http://127.0.0.1:4174/work/campaign-edge-tests/harness.html?qa
```

The structured result is exposed read-only as `window.__RATTLEWORKS_CAMPAIGN_EDGE_REGRESSION__`.
