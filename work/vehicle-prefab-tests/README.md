# Vehicle prefab regression

This deterministic runner validates the campaign car, tank, and industrial
truck kits in the real `PhysicsWorld`.

```powershell
npx.cmd tsc -p work\vehicle-prefab-tests\tsconfig.json --pretty false
node work\vehicle-prefab-tests\node-runner.mjs
```

Each vehicle is idled for ten seconds at a non-cardinal yaw. The audit rejects
implicit connectors, spontaneous breaks/explosions, non-finite body state,
large pose correction, or bodies that remain awake in the final two seconds.
It then fires a production heavy ball through each parked vehicle and applies a
separate deliberate blast, requiring visible dismantling without non-finite
motion or recursive explosions. The optional explosive cargo load is
separately idled to ensure its four drums do not self-detonate.
