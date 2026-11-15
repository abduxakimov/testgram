import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  base: './',
  plugins: [nodePolyfills({ globals: { Buffer: true, process: true, global: true } })],
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 4000 },
});
