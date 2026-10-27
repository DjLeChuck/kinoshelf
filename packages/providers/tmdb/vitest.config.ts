import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'providers-tmdb', include: ['test/**/*.test.ts'] } });
