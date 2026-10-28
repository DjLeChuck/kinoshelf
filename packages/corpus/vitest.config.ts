import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'corpus', include: ['test/**/*.test.ts'] } });
