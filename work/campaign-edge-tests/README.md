# Campaign edge regression

This focused browser harness exercises the actual `Game` runtime and HUD for four campaign fixes:

1. Picking a campaign loadout card clears selected/armed physical-weapon intent.
2. Campaign undo/redo restores both world state and loadout counts (including HUD text).
3. Sandbox catalog locks honor both explicit `unlockedItems` rewards and `lockedAfter` completion stages.
4. Every campaign level starts launch-ready, exposes Grab, and returns to Grab after a shot.

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
