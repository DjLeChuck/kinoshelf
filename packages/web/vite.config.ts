import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// `pnpm --filter @kinoshelf/web dev` talks to a server started on its default port.
const server = process.env.KINOSHELF_DEV_SERVER ?? 'http://127.0.0.1:8484';

// An object, not the `'/api': server` shorthand: the shorthand rewrites `Host` to the server's, and
// the server refuses a write whose `Origin` (the page, `localhost:5173`) is not its own `Host`.
const api = { target: server };

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023' },
  server: { proxy: { '/api': api, '/health': server } },
});
