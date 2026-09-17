import { defineConfig, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'node:path';

function portalSdk(mode: string): Plugin {
  return {
    name: 'rattleworks-portal-sdk',
    transformIndexHtml(html) {
      const sdkMarkup = mode === 'yandex'
        ? '<!-- Yandex Games SDK -->\n    <script src="/sdk.js"></script>'
        : mode === 'crazygames'
          ? '<!-- CrazyGames SDK -->\n    <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'
          : `<script>
      (() => {
        const host = location.hostname;
        if (/(^|\\.)yandex\\./i.test(host)) {
          document.write('<script src="/sdk.js"><\\/script>');
        } else if (/(^|\\.)crazygames\\./i.test(host)) {
          document.write('<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"><\\/script>');
        }
      })();
    </script>`;

      return html.replace('<!-- PORTAL_SDK -->', sdkMarkup);
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [portalSdk(mode), wasm(), topLevelAwait()],
  build: {
    outDir: mode === 'frontline' ? 'dist-frontline' : 'dist',
    rollupOptions: mode === 'frontline'
      ? { input: resolve(import.meta.dirname, 'frontline.html') }
      : undefined,
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
  },
}));
