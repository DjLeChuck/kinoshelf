import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/core',
      'packages/i18n',
      'packages/providers/tmdb',
      'packages/cli',
      'packages/server',
      'packages/corpus',
    ],
  },
});
