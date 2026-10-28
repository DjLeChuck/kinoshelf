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
 * Final pass on a rendered path segment: Windows-style filesystems reject trailing dots and
 * spaces, and every filesystem limits the segment length in bytes.
 * `reserveBytes` leaves room for what the caller appends afterwards (the extension).
 */
export function finalizeSegment(segment: string, rules: FilesystemRules, reserveBytes = 0): string {
  const limit = Math.max(1, rules.maxSegmentBytes - reserveBytes);
  let result = segment;

  // Truncate on code point boundaries so multi-byte characters are never cut in half.
  while (Buffer.byteLength(result, 'utf8') > limit) {
    result = Array.from(result).slice(0, -1).join('');
  }

  return rules.forbidden === 'windows' ? result.replace(/[. ]+$/, '') : result.trimEnd();
}
