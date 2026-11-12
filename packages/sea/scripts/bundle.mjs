// Bundles the built server and CLI into one file and writes the config `node --build-sea` reads.
// `--build` goes on to make the executable for the platform running it (the release workflow does
// the same per target). Needs `pnpm build` and `pnpm build:web` first.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { noticesOf } from './notices.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const webDist = join(root, '../web/dist');
const out = join(root, 'dist');

// The release workflow gives the tag's version: the packages all say 0.0.0 until one is cut.
const version =
  process.env.KINOSHELF_VERSION ??
  JSON.parse(readFileSync(join(root, '../server/package.json'), 'utf8')).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const { metafile } = await build({
  absWorkingDir: root,
  metafile: true,
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

const notices = noticesOf(metafile, root);
if (notices.unlicensed.length > 0) {
  // A package with no licence at all cannot be shipped: found out here, not by a user.
  throw new Error(`no licence declared by: ${notices.unlicensed.join(', ')}`);
}
mkdirSync(join(out, 'LICENSES'), { recursive: true });
writeFileSync(join(out, 'LICENSES/third-party.txt'), notices.text);

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
  // macOS refuses to modify a signed binary, and to run an unsigned one: the signature goes before
  // the injection, and an ad hoc one (no certificate) comes back after it.
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', node]);
  }
  execFileSync(process.execPath, ['--build-sea', join(out, 'sea-config.json')], {
    cwd: out,
    stdio: 'inherit',
  });
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', join(out, 'kinoshelf')]);
  }
  console.log(`executable: ${join(out, 'kinoshelf')}`);

  // Node's licence (and those of what it bundles) is at the root of its official tarball; the
  // archive has to carry it. Some distributions (nixpkgs) leave it out: said, not guessed.
  const licenseOf = join(dirname(dirname(process.execPath)), 'LICENSE');
  if (existsSync(licenseOf)) {
    mkdirSync(join(out, 'LICENSES/node'), { recursive: true });
    copyFileSync(licenseOf, join(out, 'LICENSES/node/LICENSE'));
  } else {
    console.warn(
      `warning: no Node LICENSE at ${licenseOf}; an archive cannot be made from this build`,
    );
  }
}
