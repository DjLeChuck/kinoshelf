import { createServer, type Server } from 'node:net';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { describeListenError, parseServerCommand } from '../src/startup.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

describe('parseServerCommand', () => {
  it('starts the server when asked nothing', () => {
    expect(parseServerCommand([])).toEqual({ kind: 'start' });
  });

  it.each([['--help'], ['-h'], ['help']])('prints the help for %s', (flag) => {
    expect(parseServerCommand([flag])).toEqual({ kind: 'help' });
  });

  it('prints the help for a subcommand asked for help too', () => {
    expect(parseServerCommand(['notify', '--help'])).toEqual({ kind: 'help' });
    expect(parseServerCommand(['notify', 'refresh', '-h'])).toEqual({ kind: 'help' });
  });

  it('knows its commands', () => {
    expect(parseServerCommand(['api-key', 'create'])).toEqual({ kind: 'api-key' });
    expect(parseServerCommand(['notify', 'test'])).toEqual({ kind: 'notify', args: ['test'] });
    expect(parseServerCommand(['notify', 'refresh', '/a', '--dry-run'])).toEqual({
      kind: 'notify',
      args: ['refresh', '/a', '--dry-run'],
    });
  });

  it.each([
    ['an unknown command', ['serve']],
    ['an unknown option', ['--port', '9000']],
    ['api-key without create', ['api-key']],
    ['api-key with something else', ['api-key', 'delete']],
    ['api-key create with more', ['api-key', 'create', 'now']],
  ])('refuses %s rather than starting the server and ignoring it', (_name, args) => {
    expect(parseServerCommand(args)).toEqual({ kind: 'usage-error' });
  });
});

describe('describeListenError', () => {
  it('explains a port already in use, as a real listen error reports it', async () => {
    const taken = createServer();
    servers.push(taken);
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const { port } = taken.address() as { port: number };

    const app = Fastify();
    const error: unknown = await app.listen({ host: '127.0.0.1', port }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await app.close();

    expect(describeListenError(error, '127.0.0.1', port)).toEqual({
      code: 'server.port-in-use',
      params: { host: '127.0.0.1', port },
    });
  });

  it('explains a port the user may not listen on', () => {
    expect(describeListenError({ code: 'EACCES' }, '0.0.0.0', 80)).toEqual({
      code: 'server.port-denied',
      params: { host: '0.0.0.0', port: 80 },
    });
  });

  it.each([[{ code: 'ENOTFOUND' }], [new Error('boom')], ['text'], [undefined], [null]])(
    'leaves any other failure to be reported as it is: %j',
    (error) => {
      expect(describeListenError(error, 'h', 1)).toBeUndefined();
    },
  );
});
