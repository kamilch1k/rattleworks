import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
  resolve: {
    alias: {
      '@dimforge/rapier3d': fileURLToPath(new URL('../../node_modules/@dimforge/rapier3d/rapier.js', import.meta.url)),
    },
  },
});

try {
  const module = await server.ssrLoadModule('/work/vehicle-prefab-tests/vehicle-prefab-regression.ts');
  const report = module.runVehiclePrefabRegression();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await server.close();
}
