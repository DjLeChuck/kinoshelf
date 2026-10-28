// Checks Plex and Jellyfin for real, with the clients Kinoshelf uses. Reads PLEX_URL / PLEX_TOKEN
// and JELLYFIN_URL / JELLYFIN_API_KEY from the environment (`node --env-file=../../.env …`) and
// never prints a token. Without LIVE_*_PATH it only reads (the list of libraries). With one, it asks
// the server to refresh that single folder, given as the media server itself sees it.
//
//   LIVE_PLEX_PATH=/mnt/videos/movies/Some\ Film   LIVE_PLEX_KIND=movie|series
//   LIVE_JELLYFIN_PATH=/data/movies/Some\ Film
import { deliver } from '../dist/notify/delivery.js';
import { JellyfinClient } from '../dist/notify/jellyfin.js';
import { parseSections, PlexClient } from '../dist/notify/plex.js';

const log = { info: console.log, warn: (m) => console.log(`warn: ${m}`) };
const { PLEX_URL, PLEX_TOKEN, JELLYFIN_URL, JELLYFIN_API_KEY } = process.env;
const { LIVE_PLEX_PATH, LIVE_PLEX_KIND = 'movie', LIVE_JELLYFIN_PATH } = process.env;

if (PLEX_URL && PLEX_TOKEN) {
  console.log('--- Plex');
  const plex = new PlexClient({ url: PLEX_URL, token: PLEX_TOKEN }, (r) => deliver(r), log);
  const listing = await deliver({
    method: 'GET',
    url: `${PLEX_URL.replace(/\/+$/, '')}/library/sections`,
    headers: { 'X-Plex-Token': PLEX_TOKEN, Accept: 'application/xml' },
  });
  console.log('libraries:', listing.ok ? 'ok' : `FAILED (${listing.error ?? listing.status})`);
  for (const s of listing.ok ? parseSections(listing.text ?? '') : []) {
    console.log(`  ${s.key} ${s.type}: ${s.locations.join(', ')}`);
  }
  if (LIVE_PLEX_PATH) {
    const kind = LIVE_PLEX_KIND === 'series' ? 'series' : 'movie';
    console.log(
      'refresh',
      LIVE_PLEX_PATH,
      '->',
      JSON.stringify(await plex.refresh([{ path: LIVE_PLEX_PATH, kind }])),
    );
  }
} else {
  console.log('--- Plex: PLEX_URL / PLEX_TOKEN not set, skipped');
}

if (JELLYFIN_URL && JELLYFIN_API_KEY) {
  console.log('--- Jellyfin');
  const jellyfin = new JellyfinClient(
    { url: JELLYFIN_URL, apiKey: JELLYFIN_API_KEY },
    (r) => deliver(r),
    log,
  );
  const check = await jellyfin.check();
  console.log('libraries:', check.ok ? 'ok' : `FAILED (${check.error ?? check.status})`);
  if (LIVE_JELLYFIN_PATH) {
    console.log(
      'refresh',
      LIVE_JELLYFIN_PATH,
      '->',
      JSON.stringify(await jellyfin.refresh([{ path: LIVE_JELLYFIN_PATH, kind: 'movie' }])),
    );
  }
} else {
  console.log('--- Jellyfin: JELLYFIN_URL / JELLYFIN_API_KEY not set, skipped');
}
