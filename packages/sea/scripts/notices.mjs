// The notices of the npm packages that end up inside the bundle. Their licences (MIT, ISC, BSD…)
// all ask for their text to travel with copies of the software, and the bundle is such a copy.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

/** The package a bundled file belongs to: the nearest `package.json` that has a name. */
function packageDir(file) {
  let dir = dirname(file);
  while (!existsSync(join(dir, 'package.json')) || !manifestOf(dir).name) {
    dir = dirname(dir);
  }
  return dir;
}

const declared = ({ license, licenses }) =>
  typeof license === 'string'
    ? license
    : (licenses ?? []).map((entry) => entry.type).join(' OR ') || 'unknown';

/**
 * The text listing every third-party package of an esbuild `metafile` with its licence, and
 * the packages it found that declare none (the caller decides what to do with them).
 */
export function noticesOf(metafile, base) {
  const found = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const dir = packageDir(resolve(base, input));
    const manifest = manifestOf(dir);
    // Our own packages are the program: its licence is the archive's own.
    if (manifest.name.startsWith('@kinoshelf/')) continue;
    found.set(`${manifest.name}@${manifest.version}`, { dir, manifest });
  }

  const entries = [...found]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, { dir, manifest }]) => {
      const files = readdirSync(dir).filter((name) => /^(licen[cs]e|copying|notice)/i.test(name));
      // A name is enough to say whose it is: no one's address belongs in this file.
      const author = (
        typeof manifest.author === 'string' ? manifest.author : (manifest.author?.name ?? '')
      )
        .replace(/\s*[(<][^)>]*[)>]/g, '')
        .trim();
      const text = files.length
        ? files.map((name) => readFileSync(join(dir, name), 'utf8').trim()).join('\n\n')
        : `(this package ships no licence text; it declares ${declared(manifest)}${author ? `, by ${author}` : ''})`;
      return { id, license: declared(manifest), text };
    });

  const lgpl = entries.filter(({ license }) => /LGPL/i.test(license));
  const header = [
    'Third-party software in the kinoshelf executable',
    '================================================',
    '',
    `Kinoshelf bundles ${entries.length} npm packages; each is listed below with its licence.`,
    "Node.js and FFmpeg's ffprobe come with their own licences, in the folders next to this file.",
    ...(lgpl.length
      ? [
          '',
          `${lgpl.map(({ id }) => id).join(', ')} is licensed under the GNU Lesser General Public`,
          'License. Its source is the npm package of that name; the executable is built from the Kinoshelf',
          'repository by `make sea` (scripts and pnpm-lock.yaml included), so another version can be',
          'swapped in and the executable rebuilt.',
        ]
      : []),
  ].join('\n');

  const body = entries.map(
    ({ id, license, text }) => `${id} (${license})\n${'-'.repeat(60)}\n${text}`,
  );
  return {
    text: `${[header, ...body].join('\n\n')}\n`,
    unlicensed: entries.filter(({ license }) => license === 'unknown').map(({ id }) => id),
  };
}
