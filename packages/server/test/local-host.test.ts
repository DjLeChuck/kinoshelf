import { describe, expect, it } from 'vitest';
import { allowedHosts, isLocalHost } from '../src/local-host.js';

describe('isLocalHost', () => {
  it.each([
    '192.168.1.20:8484',
    '10.0.0.5',
    '[fe80::1]:8484',
    '::1',
    'localhost:8484',
    'app.localhost',
    'nas:8484',
    'nas.local',
    'nas.lan:8484',
    'nas.home.arpa',
    'kinoshelf.internal',
    'NAS.LOCAL.',
  ])('accepts %s', (host) => {
    expect(isLocalHost(host, [])).toBe(true);
  });

  it.each(['evil.example:8484', 'kinoshelf.example.com', 'local.evil.com', '', undefined])(
    'refuses %s',
    (host) => {
      expect(isLocalHost(host, [])).toBe(false);
    },
  );

  it('accepts the names KINOSHELF_ALLOWED_HOSTS lists, port or not', () => {
    const allowed = allowedHosts({ KINOSHELF_ALLOWED_HOSTS: ' Media.Example.com , other.org' });
    expect(allowed).toEqual(['media.example.com', 'other.org']);
    expect(isLocalHost('media.example.com:443', allowed)).toBe(true);
    expect(isLocalHost('evil.example', allowed)).toBe(false);
  });
});
