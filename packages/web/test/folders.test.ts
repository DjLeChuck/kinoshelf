import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api.js';
import { childOf, openAt, parentOf, type FolderListing } from '../src/lib/folders.js';

const listing = (path: string): FolderListing => ({
  path,
  parent: parentOf(path) ?? null,
  entries: [],
  truncated: false,
});

describe('parentOf and childOf', () => {
  it('walks up to the root and no further', () => {
    expect(parentOf('/media/films')).toBe('/media');
    expect(parentOf('/media/films/')).toBe('/media');
    expect(parentOf('/media')).toBe('/');
    expect(parentOf('/')).toBeUndefined();
  });

  it('joins a folder and a name with one slash', () => {
    expect(childOf('/', 'media')).toBe('/media');
    expect(childOf('/media', 'films')).toBe('/media/films');
    expect(childOf('/media/', 'films')).toBe('/media/films');
  });
});

describe('openAt', () => {
  /** Answers for the folders that exist, 404 for the others, like the server. */
  const server = (existing: readonly string[], asked: string[] = []) => ({
    asked,
    get: <T>(url: string): Promise<T> => {
      const path = decodeURIComponent(new URL(url, 'http://x').searchParams.get('path') ?? '');
      asked.push(url);
      return existing.includes(path)
        ? Promise.resolve(listing(path) as T)
        : Promise.reject(new ApiError(404, 'fs.not-found', { path }));
    },
  });

  it('opens the typed folder when it exists', async () => {
    const { get } = server(['/media/films']);
    expect((await openAt(get, '/media/films')).path).toBe('/media/films');
  });

  it('climbs to the nearest folder that exists', async () => {
    const { get, asked } = server(['/', '/media']);
    expect((await openAt(get, '/media/films/new')).path).toBe('/media');
    expect(asked).toHaveLength(3);
  });

  it('starts at the root for an empty or relative value', async () => {
    const { get } = server(['/']);
    expect((await openAt(get, '')).path).toBe('/');
    expect((await openAt(get, 'films')).path).toBe('/');
  });

  it('asks for YAML files only when told to', async () => {
    const { get, asked } = server(['/config']);
    await openAt(get, '/config', 'yaml');
    expect(asked[0]).toBe('/api/fs?path=%2Fconfig&files=yaml');
  });

  it('gives back any other failure instead of climbing', async () => {
    const down = new ApiError(0, 'network');
    await expect(openAt(() => Promise.reject(down), '/media')).rejects.toBe(down);
  });
});
