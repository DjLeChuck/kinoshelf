import { defineConfig } from '@playwright/test';
import { API_KEY, BASE_URL, DIR, PORT, TMDB_PORT } from './support.js';

export default defineConfig({
  testDir: './test',
  // The tests share one server and one disk, and some build on what the previous one did.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    // English labels whatever the machine's language: the catalogs have their own tests.
    locale: 'en',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node stack.mjs',
    url: `${BASE_URL}/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    // The server logs every request; stderr stays on for what really goes wrong.
    stdout: 'ignore',
    env: {
      E2E_DIR: DIR,
      E2E_TMDB_PORT: String(TMDB_PORT),
      KINOSHELF_HOST: '127.0.0.1',
      KINOSHELF_PORT: String(PORT),
      KINOSHELF_CONFIG_DIR: `${DIR}/config`,
      KINOSHELF_API_KEY: API_KEY,
      KINOSHELF_TMDB_URL: `http://127.0.0.1:${TMDB_PORT}`,
      KINOSHELF_TMDB_IMAGES_URL: `http://127.0.0.1:${TMDB_PORT}/t/p`,
      TMDB_API_KEY: 'e2e-tmdb-key',
    },
  },
});
