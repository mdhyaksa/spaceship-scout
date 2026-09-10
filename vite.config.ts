import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * The Worker gates everything behind Basic auth, including /api. In the
 * two-terminal dev setup the browser talks to Vite, so it never sees the
 * Worker's 401 challenge and never prompts — the API calls would just fail.
 * Reading the same credentials the Worker uses and attaching them to proxied
 * requests keeps dev working without putting a bypass in the Worker.
 */
function devAuthHeader(): Record<string, string> {
  if (!existsSync('.dev.vars')) return {};
  const vars = Object.fromEntries(
    readFileSync('.dev.vars', 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
  if (!vars['AUTH_USER'] || !vars['AUTH_PASSWORD']) return {};
  const encoded = Buffer.from(`${vars['AUTH_USER']}:${vars['AUTH_PASSWORD']}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

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
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        headers: devAuthHeader(),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
  },
} as never);
