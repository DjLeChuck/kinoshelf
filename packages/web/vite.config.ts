import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// `pnpm --filter @kinoshelf/web dev` talks to a server started on its default port.
const server = process.env.KINOSHELF_DEV_SERVER ?? 'http://127.0.0.1:8484';

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023' },
  server: { proxy: { '/api': server, '/health': server } },
});
