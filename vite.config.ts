import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@worker': fileURLToPath(new URL('./worker', import.meta.url)),
      '@semantic': fileURLToPath(new URL('./semantic', import.meta.url)),
    },
  },
  server: {
    // `wrangler dev` serves the API; Vite proxies to it so the SPA and the
    // Worker share an origin in development exactly as they do in production.
    // Cookies set by the Worker come back through the proxy on the same
    // origin, so the login flow works identically here and in production.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
  },
} as never);
