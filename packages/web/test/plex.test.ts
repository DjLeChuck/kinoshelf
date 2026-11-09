import { describe, expect, it } from 'vitest';
import { addressesOf, ownedServers, type PlexServer } from '../src/lib/plex.js';

const connection = (uri: string, local = true, relay = false) => ({ uri, local, relay });

// What a real account answered: the same machine listed under every address it has.
const nas: PlexServer = {
  name: 'NAS',
  owned: true,
  connections: [
    connection(
      'https://fdd0-0000-0000-0005-0000-0000-0000-0002.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:32400',
    ),
    connection('https://172-16-4-2.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:32400'),
    connection('https://82-66-110-251.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:32400'),
    connection(
      'https://178-79-172-216.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:8443',
      false,
      true,
    ),
  ],
};

describe('addressesOf', () => {
  it('offers the plain local address first, then the same one encrypted, public, IPv6, relay', () => {
    expect(addressesOf(nas).map((a) => [a.kind, a.label, a.uri])).toEqual([
      ['local', '172.16.4.2:32400', 'http://172.16.4.2:32400'],
      [
        'secure',
        '172.16.4.2:32400',
        'https://172-16-4-2.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:32400',
      ],
      [
        'remote',
        '82.66.110.251:32400',
        'https://82-66-110-251.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:32400',
      ],
      [
        'local',
        '[fdd0:0000:0000:0005:0000:0000:0000:0002]:32400',
        'https://fdd0-0000-0000-0005-0000-0000-0000-0002.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:32400',
      ],
      [
        'relay',
        '178.79.172.216:8443',
        'https://178-79-172-216.906fc285505f4fc1b2419a1a2ba7d825.plex.direct:8443',
      ],
    ]);
  });

  it('never sends plain HTTP over the Internet: a public address keeps its plex.direct name', () => {
    const plain = addressesOf(nas).filter((a) => a.uri.startsWith('http://'));
    expect(plain.map((a) => a.label)).toEqual(['172.16.4.2:32400']);
  });

  it('keeps Plex’s order among equals, so a Docker bridge never beats the first address', () => {
    const linux: PlexServer = {
      name: 'djlechuck-linux',
      owned: true,
      connections: [
        'https://192-168-0-119.a6ea07e2913445e8acf34f82d0c67ac3.plex.direct:32400',
        'https://172-17-0-1.a6ea07e2913445e8acf34f82d0c67ac3.plex.direct:32400',
        'https://172-18-0-1.a6ea07e2913445e8acf34f82d0c67ac3.plex.direct:32400',
      ].map((uri) => connection(uri)),
    };
    expect(addressesOf(linux)[0]).toMatchObject({
      uri: 'http://192.168.0.119:32400',
      kind: 'local',
    });
    expect(addressesOf(linux).map((a) => a.label)).toEqual([
      '192.168.0.119:32400',
      '172.17.0.1:32400',
      '172.18.0.1:32400',
      '192.168.0.119:32400',
      '172.17.0.1:32400',
      '172.18.0.1:32400',
    ]);
  });

  it('leaves a name that is not a plex.direct one, and a plain address, as they are', () => {
    const plain: PlexServer = {
      name: 'x',
      owned: true,
      connections: [connection('http://plex.home:32400'), connection('http://192.168.1.10:32400')],
    };
    expect(addressesOf(plain).map((a) => [a.uri, a.kind])).toEqual([
      ['http://192.168.1.10:32400', 'local'],
      ['http://plex.home:32400', 'remote'],
    ]);
  });
});

describe('ownedServers', () => {
  it('leaves out a friend’s server, which only its owner can ask to refresh', () => {
    const friend: PlexServer = { ...nas, name: 'ROLENET', owned: false };
    expect(ownedServers([nas, friend]).map((s) => s.name)).toEqual(['NAS']);
  });
});
