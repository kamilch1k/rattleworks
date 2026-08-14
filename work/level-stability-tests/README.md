# Authored level stability audit

This deterministic runner spawns every production campaign definition through
`PhysicsWorld`, creates only the authored rope/weight connectors, and advances
each level for ten idle seconds. It reports peak motion, explosions, removals,
expanded rigid-body count, character damage/defeats, and per-object pose drift.
A dynamic structural piece counts as collapsed after 30 cm of total movement,
20 cm of downward movement, or 15 degrees of rotation. The audit fails on any
spontaneous target/friendly damage or defeat and keeps authored scenes at 80 definitions
or fewer so the live campaign leaves room for shots and break debris.

```powershell
npx.cmd tsc -p work\level-stability-tests\tsconfig.json --pretty false
node work\level-stability-tests\node-runner.mjs
```
