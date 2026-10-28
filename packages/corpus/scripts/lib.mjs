// Shared helpers for the corpus scripts. Run them from the repository root (see ../README.md).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Git-ignored scratch space for results and the TMDB cache. */
export const WORK = new URL('../.work/', import.meta.url);
export const workPath = (name) => {
  mkdirSync(WORK, { recursive: true });
  return new URL(name, WORK).pathname;
};

/** `--name value` options and positional arguments. */
export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      options[argv[i].slice(2)] =
        argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { options, positional };
}

export const absolute = (path) => resolve(process.cwd(), path);

/** Accents, case, apostrophes and punctuation flattened, to compare titles by eye. */
export function norm(text) {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Season and episodes read from the file name by a regex independent of the parser. */
export function seasonEpisodes(name) {
  const m = /S(\d{1,2})E(\d{1,3})(?:-?E(\d{1,3}))?/i.exec(name);
  return m
    ? { season: Number(m[1]), episodes: [Number(m[2]), ...(m[3] ? [Number(m[3])] : [])] }
    : undefined;
}

/** The parser only reads the last three path segments, so entries keep no more. */
export const lastSegments = (path, n = 3) => path.split('/').slice(-n).join('/');

/** Small seedable generator so a selection can be replayed. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
