import { describe, expect, it } from 'vitest';
import type { Library, LibraryBody } from '../src/lib/libraries.js';
import { createDestinations } from '../src/lib/onboarding.js';

function libraries(refuse: (body: LibraryBody) => boolean) {
  const made: string[] = [];
  return {
    made,
    create: (body: LibraryBody): Promise<Library> => {
      if (refuse(body)) {
        return Promise.reject(new Error('refused'));
      }
      made.push(body.name);
      return Promise.resolve({ id: body.name } as Library);
    },
    remove: (id: string): Promise<void> => {
      made.splice(made.indexOf(id), 1);
      return Promise.resolve();
    },
  };
}

const movies: LibraryBody = { name: 'films', source: '/m', type: 'movie' };
const series: LibraryBody = { name: 'series', source: '/s', type: 'series' };

describe('createDestinations', () => {
  it('makes both libraries', async () => {
    const api = libraries(() => false);
    await createDestinations(api, movies, series);
    expect(api.made).toEqual(['films', 'series']);
  });

  it('takes the first one back when the second is refused', async () => {
    const api = libraries((body) => body.type === 'series');
    await expect(createDestinations(api, movies, series)).rejects.toThrow('refused');
    expect(api.made).toEqual([]);
  });
});
