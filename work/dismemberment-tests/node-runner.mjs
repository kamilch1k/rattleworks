import * as THREE from 'three';
import { createServer } from 'vite';

// The production physics path deliberately skips image loading outside a DOM.
// WorldTheme's definition-only regression still calls TextureLoader, so supply
// an inert texture object without changing the production module.
THREE.TextureLoader.prototype.load = function load(_url, onLoad) {
  const texture = new THREE.Texture();
  texture.image = { width: 1, height: 1 };
  queueMicrotask(() => onLoad?.(texture));
  return texture;
};

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
});

try {
  const module = await server.ssrLoadModule('/work/dismemberment-tests/dismemberment-regression.ts');
  const report = await module.runDismembermentRegression();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.pass ? 0 : 1;
} finally {
  await server.close();
}
