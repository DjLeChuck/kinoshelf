import { describe, expect, it } from 'vitest';
import { route } from '../src/route.js';

describe('route', () => {
  it('starts the server on `serve` and hides the word from it', () => {
    expect(route(['serve'])).toEqual({ target: 'server', argv: [] });
  });

  it('sends the server its own commands untouched', () => {
    expect(route(['api-key', 'create'])).toEqual({ target: 'server', argv: ['api-key', 'create'] });
    expect(route(['notify', 'test'])).toEqual({ target: 'server', argv: ['notify', 'test'] });
  });

  it('leaves everything else to the CLI, help and mistakes included', () => {
    for (const argv of [[], ['scan', '/media'], ['submit', '/x'], ['--help'], ['nope']]) {
      expect(route(argv)).toEqual({ target: 'cli', argv });
    }
  });
});
