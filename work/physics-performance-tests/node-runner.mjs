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
  const module = await server.ssrLoadModule('/work/physics-performance-tests/smoke.ts');
  process.stdout.write(`${JSON.stringify(module.runPhysicsPerformanceSmoke(), null, 2)}\n`);
} finally {
  await server.close();
}
