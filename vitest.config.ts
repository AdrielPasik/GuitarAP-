import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwa-register-mock.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    // The suite grew (40 files, real PostgreSQL in WASM, lazily imported screens): 5 s is too tight when files run in parallel.
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['node_modules/**', 'tests/e2e/**'],
  },
});
