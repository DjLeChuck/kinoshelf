import type { FilesystemRules } from '../types/profile.js';

const FORBIDDEN = {
  windows: /[<>:"/\\|?*\u0000-\u001f]/g,
  posix: /[/\u0000]/g,
} as const;

/** Cleans a substituted value so it can never introduce a path separator or forbidden char. */
export function sanitizeValue(value: string, rules: FilesystemRules): string {
  return value.replace(FORBIDDEN[rules.forbidden], rules.replacement).replace(/\s+/g, ' ').trim();
}

/**
 * Final pass on a rendered path segment: a leading dot would hide it (`...And Justice for All`
 * would vanish from the next scan, which skips hidden entries, and from most players), Windows-style
 * filesystems reject trailing dots and spaces, and every filesystem limits the segment length in
 * bytes. `reserveBytes` leaves room for what the caller appends afterwards (the extension).
 */
export function finalizeSegment(segment: string, rules: FilesystemRules, reserveBytes = 0): string {
  const limit = Math.max(1, rules.maxSegmentBytes - reserveBytes);
  let result = segment.replace(/^[.\s]+/, '');

  if (Buffer.byteLength(result, 'utf8') > limit) {
    // The id the player matches on (`{tmdb-603}`, `[tmdbid-603]`) closes the name: it is the part
    // that must survive, so the title before it gives way.
    const tag = TRAILING_ID.exec(result)?.[0] ?? '';
    const room = limit - Buffer.byteLength(tag, 'utf8');
    result =
      room > 0
        ? `${cut(result.slice(0, result.length - tag.length), room)}${tag}`
        : cut(result, limit);
  }

  result = rules.forbidden === 'windows' ? result.replace(/[. ]+$/, '') : result.trimEnd();
  return rules.forbidden === 'windows' ? unreserved(result) : result;
}

const TRAILING_ID = /\s*[{[][a-z]+-\d+[}\]]$/i;

/** Cuts on code point boundaries so multi-byte characters are never cut in half. */
function cut(text: string, bytes: number): string {
  let used = 0;
  let result = '';
  for (const char of text) {
    used += Buffer.byteLength(char, 'utf8');
    if (used > bytes) {
      break;
    }
    result += char;
  }
  return result;
}

// Names Windows reserves for devices, with or without an extension (`CON.mkv` is still `CON`).
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A reserved device name cannot be created on a Windows filesystem: an underscore makes it one. */
function unreserved(segment: string): string {
  return RESERVED.test(segment) ? `_${segment}` : segment;
}
