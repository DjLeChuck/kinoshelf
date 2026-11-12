// Bundles the built server and CLI into one file and writes the config `node --build-sea` reads.
// `--build` goes on to make the executable for the platform running it (the release workflow does
// the same per target). Needs `pnpm build` and `pnpm build:web` first.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const webDist = join(root, '../web/dist');
const out = join(root, 'dist');

const { version } = JSON.parse(readFileSync(join(root, '../server/package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/main.mjs')],
  outfile: join(out, 'kinoshelf.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  // Some dependencies (yaml) are CommonJS and call `require`, which an ES module does not have.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  define: { KINOSHELF_VERSION: JSON.stringify(version) },
  logLevel: 'warning',
});

/** Every file of the web build, under `web/` (where `findWebRoot` looks). */
function assetsOf(dir) {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = join(entry.parentPath, entry.name);
        return [`web/${relative(dir, file).split('\\').join('/')}`, file];
      }),
  );
}

const config = {
  main: 'kinoshelf.mjs',
  mainFormat: 'module',
  executable: 'node',
  output: 'kinoshelf',
  useVfs: true,
  disableExperimentalSEAWarning: true,
  assets: assetsOf(webDist),
};
writeFileSync(join(out, 'sea-config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `bundle: ${join(out, 'kinoshelf.mjs')} (${Object.keys(config.assets).length} web files)`,
);

if (process.argv.includes('--build')) {
  // The injection needs a copy of node to write into; stripping it first (Linux) saves some 40 MB,
  // and has to come before the injection, which a strip would break.
  const node = join(out, 'node');
  if (process.platform === 'linux') {
    execFileSync('strip', ['--strip-unneeded', '-o', node, process.execPath]);
  } else {
    copyFileSync(process.execPath, node);
  }
  execFileSync(process.execPath, ['--build-sea', join(out, 'sea-config.json')], {
    cwd: out,
    stdio: 'inherit',
  });
  console.log(`executable: ${join(out, 'kinoshelf')}`);
}
