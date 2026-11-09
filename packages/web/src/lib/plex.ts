/** `POST /api/plex/auth`: the page where the user approves Kinoshelf, and the PIN to ask about. */
export interface PlexPin {
  readonly id: number;
  readonly url: string;
}

/** `GET /api/plex/servers`: one server of the signed-in account, with the addresses to reach it. */
export interface PlexServer {
  readonly name: string;
  readonly owned: boolean;
  readonly connections: readonly {
    readonly uri: string;
    readonly local: boolean;
    readonly relay: boolean;
  }[];
}

/** How often the page asks whether the PIN was claimed, and how long it keeps asking. */
export const PLEX_POLL_MS = 2000;
export const PLEX_GIVE_UP_MS = 10 * 60_000;

export type AddressKind = 'local' | 'secure' | 'remote' | 'relay';

export interface PlexAddress {
  /** What goes in the field. */
  readonly uri: string;
  /** What a person reads: `192.168.0.119:32400`, not `192-168-0-119.<hash>.plex.direct:32400`. */
  readonly label: string;
  readonly kind: AddressKind;
}

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const DASHED_V4 = /^\d{1,3}(-\d{1,3}){3}$/;
const DASHED_V6 = /^[0-9a-f]{1,4}(-[0-9a-f]{0,4}){2,7}$/i;

/** `plex.direct` names carry the address with its dots (or colons) turned into dashes. */
function hostOf(hostname: string): { host: string; direct: boolean } {
  const [first = hostname, hash = '', ...rest] = hostname.split('.');
  if (rest.join('.') !== 'plex.direct' || !/^[0-9a-f]{32}$/i.test(hash)) {
    return { host: hostname, direct: false };
  }
  return DASHED_V4.test(first)
    ? { host: first.replaceAll('-', '.'), direct: true }
    : DASHED_V6.test(first)
      ? { host: first.replaceAll('-', ':'), direct: true }
      : { host: hostname, direct: false };
}

/**
 * A server's addresses, best first. On the local network the plain `http://<ip>:<port>` comes first
 * (what one would type, and what does not depend on a public DNS name: a router that refuses
 * names pointing at private addresses breaks `plex.direct`), then the same address encrypted, for
 * a server that requires secure connections. Then any other IPv4, IPv6, and the relay last, whose
 * bandwidth is limited: those keep Plex's `plex.direct` address, since plain HTTP over the Internet
 * is not something to offer. Plex lists a dozen for one server (every Docker bridge, both
 * families): the order is Plex's within a rank, so what it says first among equals stays first.
 */
export function addressesOf(server: PlexServer): PlexAddress[] {
  const ranked = server.connections.flatMap(
    (connection): { rank: number; address: PlexAddress }[] => {
      let host = connection.uri;
      let port = '';
      let direct = false;
      try {
        const url = new URL(connection.uri);
        ({ host, direct } = hostOf(url.hostname));
        port = url.port === '' ? '' : `:${url.port}`;
      } catch {
        // not a URL: shown as it came
      }
      const v6 = host.includes(':');
      const label = `${v6 ? `[${host}]` : host}${port}`;
      const priv = PRIVATE_V4.test(host);
      if (connection.relay) {
        return [{ rank: 3, address: { uri: connection.uri, label, kind: 'relay' } }];
      }
      if (priv && direct) {
        return [
          { rank: 0, address: { uri: `http://${host}${port}`, label, kind: 'local' } },
          { rank: 0.5, address: { uri: connection.uri, label, kind: 'secure' } },
        ];
      }
      const kind: AddressKind = priv || (connection.local && v6) ? 'local' : 'remote';
      return [{ rank: priv ? 0 : v6 ? 2 : 1, address: { uri: connection.uri, label, kind } }];
    },
  );
  return ranked
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.address);
}

/**
 * The servers one can ask to refresh a library: those of the account itself. A server shared by
 * a friend answers to its owner only, so listing it would offer an address that always fails.
 */
export const ownedServers = (servers: readonly PlexServer[]): PlexServer[] =>
  servers.filter((server) => server.owned && server.connections.length > 0);
