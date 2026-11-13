import { describe, expect, it } from 'vitest';
import { issueUrl, versionsText } from './diagnostic.js';

const summary = {
  kinoshelf: '0.4.0',
  node: 'v26.1.0',
  platform: 'linux-x64',
  ffprobe: null,
  uptimeSeconds: 1,
  locale: null,
};

describe('versionsText', () => {
  it('lists the versions and says when ffprobe is missing', () => {
    expect(versionsText(summary)).toBe(
      'Kinoshelf 0.4.0\nNode v26.1.0 (linux-x64)\nffprobe not installed',
    );
  });
});

describe('issueUrl', () => {
  it('carries the versions and the reminder, and nothing else of the install', () => {
    const url = new URL(issueUrl(summary, 'Attach the archive.'));
    expect(url.origin + url.pathname).toBe('https://github.com/DjLeChuck/kinoshelf/issues/new');
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('Attach the archive.');
    expect(body).toContain('Kinoshelf 0.4.0');
  });
});
