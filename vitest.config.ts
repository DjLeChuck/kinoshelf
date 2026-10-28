import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/core',
      'packages/providers/tmdb',
      'packages/cli',
      'packages/server',
      'packages/corpus',
    ],
  },
});
