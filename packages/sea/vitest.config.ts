import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'sea', include: ['test/**/*.test.ts'] } });
