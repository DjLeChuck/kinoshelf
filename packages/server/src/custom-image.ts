import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { ApiError } from './api-error.js';

/** The same ceiling as artwork the pipeline downloads (`core/src/execution/download.ts`). */
export const MAX_CUSTOM_IMAGE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export type ImageFormat = 'jpeg' | 'png';

export interface CustomImage {
  readonly bytes: Uint8Array;
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
}

export interface CustomImageOptions {
  /** Lets the address point to the machine's own network (a NAS); off by default. */
  readonly allowLocalNetwork: boolean;
  /** Replaces the address policy, for tests that cannot use a public address. */
  readonly isBlocked?: (address: string) => boolean;
  readonly timeoutMs?: number;
}

const octets = (address: string): number[] => address.split('.').map(Number);

function blockedV4(address: string): boolean {
  const [a = 0, b = 0] = octets(address);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * Whether an address belongs to the machine or its network. IPv6 forms that embed an IPv4 address
 * (`::ffff:10.0.0.1`) are judged by it, or the filter would be one prefix away from useless.
 */
export function isLocalAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    return blockedV4(ip);
  }
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) {
    return blockedV4(mapped[1]);
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex?.[1] && hex[2]) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return blockedV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return (
    ip === '::' ||
    ip === '::1' ||
    /^f[cd]/.test(ip) || // unique local
    /^fe[89ab]/.test(ip) || // link-local
    /^ff/.test(ip) // multicast
  );
}

const fail = (
  code: ConstructorParameters<typeof ApiError>[1],
  params?: Record<string, string | number>,
) => new ApiError(422, code, params);

/** An http(s) address with no credentials in it; anything else is not an image address. */
export function parseImageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw fail('image.url-invalid');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw fail('image.url-invalid');
  }
  return url;
}

interface Hop {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: Uint8Array;
}

/**
 * One request. The address is judged where the connection is made (`lookup`), on what the name
 * resolved to: checking it beforehand and letting `fetch` resolve again would leave a gap for a DNS
 * answer that changes in between (rebinding).
 */
function requestOnce(url: URL, options: CustomImageOptions): Promise<Hop> {
  const blocked = options.isBlocked ?? isLocalAddress;
  const literal = isIP(url.hostname.replace(/^\[|\]$/g, ''));
  if (!options.allowLocalNetwork && literal !== 0 && blocked(url.hostname)) {
    return Promise.reject(fail('image.url-blocked'));
  }
  const lookup: Lookup = (hostname, lookupOptions, callback) => {
    dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      const [first] = addresses;
      if (error) {
        callback(error, '', 0);
      } else if (!options.allowLocalNetwork && addresses.some(({ address }) => blocked(address))) {
        callback(Object.assign(new Error('blocked'), { code: 'BLOCKED' }), '', 0);
      } else if (!first) {
        callback(new Error('no address'), '', 0);
      } else if (lookupOptions.all) {
        // Node asks for every address when it may try several families.
        (callback as unknown as AllCallback)(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
  const send = url.protocol === 'https:' ? https.request : http.request;

  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'GET',
        lookup,
        timeout: options.timeoutMs ?? TIMEOUT_MS,
        // No cookies, no key: this address is the user's, not ours.
        headers: { accept: 'image/jpeg,image/png', 'user-agent': 'Kinoshelf' },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers: response.headers, body: new Uint8Array() });
          return;
        }
        const declared = Number(response.headers['content-length']);
        if (declared > MAX_CUSTOM_IMAGE_BYTES) {
          response.destroy();
          reject(fail('image.url-too-large', { max: MAX_CUSTOM_IMAGE_BYTES }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_CUSTOM_IMAGE_BYTES) {
            // Cut an endless body instead of filling the memory with it.
            response.destroy();
            reject(fail('image.url-too-large', { max: MAX_CUSTOM_IMAGE_BYTES }));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ status, headers: response.headers, body: Buffer.concat(chunks) });
        });
        response.on('error', () => {
          reject(fail('image.url-unreachable', { status: 'network' }));
        });
      },
    );
    request.on('timeout', () => {
      request.destroy();
      reject(fail('image.url-unreachable', { status: 'timeout' }));
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'BLOCKED'
          ? fail('image.url-blocked')
          : fail('image.url-unreachable', { status: 'network' }),
      );
    });
    request.end();
  });
}

type Lookup = (
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void;
type AllCallback = (error: null, addresses: LookupAddress[]) => void;

/** The format by the file's own first bytes: a `Content-Type` is only what the server claims. */
function formatOf(bytes: Uint8Array): ImageFormat | 'webp' | undefined {
  const has = (offset: number, ...values: number[]): boolean =>
    values.every((value, index) => bytes[offset + index] === value);
  if (has(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'png';
  }
  if (has(0, 0xff, 0xd8, 0xff)) {
    return 'jpeg';
  }
  if (has(0, 0x52, 0x49, 0x46, 0x46) && has(8, 0x57, 0x45, 0x42, 0x50)) {
    return 'webp';
  }
  return undefined;
}

/** Width and height from the headers, so no decoder is needed; `undefined` if unreadable. */
export function dimensionsOf(
  bytes: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === 'png') {
    return bytes.length >= 24
      ? { width: view.getUint32(16), height: view.getUint32(20) }
      : undefined;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return undefined;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // A frame header (SOF0..SOF15) except DHT, JPG and DAC, which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

/**
 * Downloads an image the user pointed at. http and https only, three redirections at most, each one
 * judged like the first; 20 MB; a JPEG or PNG by its bytes. Nothing reaches the disk here: the
 * caller writes what this returns, or the request fails with nothing written.
 */
export async function fetchCustomImage(
  address: string,
  options: CustomImageOptions,
): Promise<CustomImage> {
  let url = parseImageUrl(address);
  for (let redirects = 0; ; redirects++) {
    const hop = await requestOnce(url, options);
    if (hop.status >= 300 && hop.status < 400) {
      const location = hop.headers.location;
      if (!location) {
        throw fail('image.url-unreachable', { status: hop.status });
      }
      if (redirects >= MAX_REDIRECTS) {
        throw fail('image.url-too-many-redirects');
      }
      try {
        url = parseImageUrl(new URL(location, url).href);
      } catch {
        throw fail('image.url-invalid');
      }
      continue;
    }
    if (hop.status < 200 || hop.status >= 300) {
      throw fail('image.url-unreachable', { status: hop.status });
    }
    const type = (hop.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!type.startsWith('image/')) {
      throw fail('image.url-not-image', { type: type || 'unknown' });
    }
    const format = formatOf(hop.body);
    if (format === undefined) {
      throw fail('image.url-not-image', { type });
    }
    if (format === 'webp') {
      throw fail('image.url-unsupported', { type: 'WebP' });
    }
    const size = dimensionsOf(hop.body, format);
    if (!size || size.width < 1 || size.height < 1) {
      throw fail('image.url-not-image', { type });
    }
    return { bytes: hop.body, format, ...size };
  }
}
