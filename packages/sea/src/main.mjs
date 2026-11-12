import { route } from './route.js';

// Both programs run at import and read `process.argv.slice(2)`, so the one not wanted is never
// loaded and the other sees the arguments as if it had been started alone.
const { target, argv } = route(process.argv.slice(2));
process.argv.splice(2, process.argv.length - 2, ...argv);

if (target === 'server') {
  await import('../../server/dist/main.js');
} else {
  await import('../../cli/dist/main.js');
}
