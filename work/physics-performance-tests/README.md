# Physics performance smoke

This focused smoke test exercises the optimized `PhysicsWorld` hot paths with
100 props, a fan, and a magnet for 180 fixed frames. It verifies finite body
state and bookkeeping, then triggers an explosion against a compound ragdoll to
ensure the performance changes preserve bounded dismemberment and joint counts.

Run the type boundary:

```powershell
npx.cmd tsc -p work\physics-performance-tests\tsconfig.json --pretty false
```

Run the deterministic smoke:

```powershell
node work\physics-performance-tests\node-runner.mjs
```

The elapsed time is a local diagnostic, not a universal threshold. Correctness
is enforced by the entity, finite-transform, collider, and joint assertions.
