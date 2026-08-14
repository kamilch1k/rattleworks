# Dismemberment regression harness

This browser harness imports the production `PhysicsWorld` and `WorldTheme`
modules. It verifies explosion and heavy-projectile severing, weak-impact and
self-contact negative cases, Rapier wrapper/body/collider integrity, reset
safety, and bounded managed theme props.

Run strict type checking with:

```powershell
npx.cmd tsc -p work/dismemberment-tests/tsconfig.json --pretty false
```

With the Vite development server running, open:

`http://127.0.0.1:4173/work/dismemberment-tests/harness.html`

The full machine-readable report is published on
`window.__RATTLEWORKS_DISMEMBERMENT_REGRESSION__`.

When no browser backend is connected, the same exported scenarios can be run
through Vite's production module pipeline (texture I/O is stubbed, physics is
not):

```powershell
node work/dismemberment-tests/node-runner.mjs
```
