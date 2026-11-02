import { isIP } from 'node:net';

/** Suffixes only a local resolver answers for: no one on the internet can point them anywhere. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.home.arpa', '.internal'];

/** The names `KINOSHELF_ALLOWED_HOSTS` adds, comma-separated, lowercase, ports left out. */
export function allowedHosts(env: Readonly<Record<string, string | undefined>>): string[] {
  return (env.KINOSHELF_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
}

/** The host name of a `Host` header, without its port or the brackets of an IPv6 address. */
function hostName(header: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(header);
  if (bracketed?.[1] !== undefined) {
    return bracketed[1];
  }
  // A bare IPv6 address has several colons; a name or an IPv4 address has one before the port.
  return header.split(':').length > 2 ? header : (header.split(':')[0] ?? '');
}

/**
 * True when the server was reached by a name a page on the internet cannot make its own: an IP
 * address, `localhost`, a name without a dot (`nas`), a local suffix (`nas.local`), or one listed in
 * `KINOSHELF_ALLOWED_HOSTS`. A rebinding attack needs the attacker's own domain to resolve to this
 * server, and the browser then sends that domain as the `Host`; checking `Origin` against `Host`
 * cannot see it, since both name the attacker's domain.
 */
export function isLocalHost(header: string | undefined, allowed: readonly string[]): boolean {
  if (header === undefined || header === '') {
    return false;
  }
  const name = hostName(header).toLowerCase().replace(/\.$/, '');
  return (
    isIP(name) !== 0 ||
    name === 'localhost' ||
    !name.includes('.') ||
    LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    allowed.includes(name)
  );
}
