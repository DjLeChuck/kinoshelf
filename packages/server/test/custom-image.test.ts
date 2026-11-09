import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/api-error.js';
import {
  MAX_CUSTOM_IMAGE_BYTES,
  dimensionsOf,
  fetchCustomImage,
  isLocalAddress,
} from '../src/custom-image.js';

/** A 3x2 PNG header followed by nothing a decoder would need: the dimensions are what is read. */
const png = (width = 3, height = 2): Buffer => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

/** A JPEG with a comment segment before its frame header, as cameras and editors write. */
const jpeg = (width = 640, height = 480): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x68, 0x69]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255]),
    Buffer.alloc(10),
  ]);

type Handler = Parameters<typeof createServer>[1];
const servers: Server[] = [];
async function serve(handler: Handler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

const lan = { allowLocalNetwork: true } as const;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ApiError ? error.code : 'unexpected';
  }
  return undefined;
}

describe('isLocalAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
  ])('blocks %s', (address) => {
    expect(isLocalAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'lets %s through',
    (address) => {
      expect(isLocalAddress(address)).toBe(false);
    },
  );
});

describe('dimensionsOf', () => {
  it('reads a PNG and a JPEG whose frame header comes after another segment', () => {
    expect(dimensionsOf(png(300, 100), 'png')).toEqual({ width: 300, height: 100 });
    expect(dimensionsOf(jpeg(1000, 1500), 'jpeg')).toEqual({ width: 1000, height: 1500 });
  });

  it('gives up on a truncated file', () => {
    expect(dimensionsOf(png().subarray(0, 10), 'png')).toBeUndefined();
    expect(dimensionsOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'jpeg')).toBeUndefined();
  });
});

describe('fetchCustomImage', () => {
  const serving =
    (body: Buffer, type = 'image/png'): Handler =>
    (_request, response) => {
      response.writeHead(200, { 'content-type': type }).end(body);
    };

  it('downloads a PNG and a JPEG and tells their size, whatever the extension says', async () => {
    const base = await serve((request, response) =>
      serving(request.url === '/a.jpg' ? jpeg(640, 480) : png(30, 20), 'image/png')?.(
        request,
        response,
      ),
    );
    expect(await fetchCustomImage(`${base}/a.png`, lan)).toMatchObject({
      format: 'png',
      width: 30,
      height: 20,
    });
    expect(await fetchCustomImage(`${base}/a.jpg`, lan)).toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 480,
    });
  });

  it('refuses the local network by default, before any connection', async () => {
    let hits = 0;
    const base = await serve((request, response) => {
      hits++;
      serving(png())?.(request, response);
    });
    expect(await codeOf(fetchCustomImage(`${base}/a.png`, { allowLocalNetwork: false }))).toBe(
      'image.url-blocked',
    );
    // A name that resolves to the machine is caught where the connection is made.
    const named = base.replace('127.0.0.1', 'localhost');
    expect(await codeOf(fetchCustomImage(`${named}/a.png`, { allowLocalNetwork: false }))).toBe(
      'image.url-blocked',
    );
    expect(hits).toBe(0);
  });

  it('judges every redirection like the first address', async () => {
    const inner = await serve(serving(png()));
    const port = new URL(inner).port;
    const outer = await serve((_request, response) => {
      // 127.0.0.2 is "the local network" in this test; the first hop is not.
      response.writeHead(302, { location: `http://127.0.0.2:${port}/secret.png` }).end();
    });
    const blocked = (address: string): boolean => address === '127.0.0.2';
    expect(
      await codeOf(
        fetchCustomImage(`${outer}/a.png`, { allowLocalNetwork: false, isBlocked: blocked }),
      ),
    ).toBe('image.url-blocked');
  });

  it('follows a few redirections and stops after three', async () => {
    const base = await serve((request, response) => {
      const step = Number(/\/(\d+)$/.exec(request.url ?? '')?.[1] ?? 0);
      if (request.url?.startsWith('/loop')) {
        response.writeHead(302, { location: '/loop' }).end();
      } else if (step < 2) {
        response.writeHead(302, { location: `/r/${step + 1}` }).end();
      } else {
        serving(png())?.(request, response);
      }
    });
    expect(await fetchCustomImage(`${base}/r/0`, lan)).toMatchObject({ format: 'png' });
    expect(await codeOf(fetchCustomImage(`${base}/loop`, lan))).toBe(
      'image.url-too-many-redirects',
    );
  });

  it.each([
    ['ftp://example.org/a.png', 'image.url-invalid'],
    ['file:///etc/passwd', 'image.url-invalid'],
    ['not a url', 'image.url-invalid'],
    ['http://user:secret@example.org/a.png', 'image.url-invalid'],
  ])('refuses %s without connecting', async (address, code) => {
    expect(await codeOf(fetchCustomImage(address, lan))).toBe(code);
  });

  it('refuses a page, whatever its extension', async () => {
    const base = await serve(serving(Buffer.from('<html></html>'), 'text/html'));
    expect(await codeOf(fetchCustomImage(`${base}/a.png`, lan))).toBe('image.url-not-image');
  });

  it('refuses a body that is no image although the server says it is one', async () => {
    const base = await serve(serving(Buffer.from('<html>not a picture</html>'), 'image/png'));
    expect(await codeOf(fetchCustomImage(`${base}/a.png`, lan))).toBe('image.url-not-image');
  });

  it('says WebP is not supported rather than that it is no image', async () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    const base = await serve(serving(webp, 'image/webp'));
    expect(await codeOf(fetchCustomImage(`${base}/a.webp`, lan))).toBe('image.url-unsupported');
  });

  it('refuses a file it cannot measure', async () => {
    const base = await serve(serving(png().subarray(0, 12)));
    expect(await codeOf(fetchCustomImage(`${base}/a.png`, lan))).toBe('image.url-not-image');
  });

  it('refuses an error status', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(404).end();
    });
    expect(await codeOf(fetchCustomImage(`${base}/a.png`, lan))).toBe('image.url-unreachable');
  });

  it('refuses a body over the limit, declared or not', async () => {
    const declared = await serve((_request, response) => {
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(MAX_CUSTOM_IMAGE_BYTES + 1),
      });
      response.end(png());
    });
    expect(await codeOf(fetchCustomImage(`${declared}/a.png`, lan))).toBe('image.url-too-large');

    const endless = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      const chunk = Buffer.alloc(1024 * 1024);
      const timer = setInterval(() => response.write(chunk), 1);
      response.on('close', () => {
        clearInterval(timer);
      });
    });
    expect(await codeOf(fetchCustomImage(`${endless}/a.png`, lan))).toBe('image.url-too-large');
  });

  it('gives up on a server that never answers', async () => {
    const base = await serve(() => undefined);
    expect(await codeOf(fetchCustomImage(`${base}/a.png`, { ...lan, timeoutMs: 100 }))).toBe(
      'image.url-unreachable',
    );
  });
});
