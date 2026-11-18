import type {
  Certification,
  MovieDetails,
  Person,
  Rating,
  SeriesDetails,
} from '../types/details.js';
import type { EpisodeInfo } from '../types/provider.js';

/**
 * Kodi-format NFO files (read by Kodi, Jellyfin and Plex's "Plex NFO" agent), as pure text: no
 * disk, no network. Tag names and order follow the official Kodi templates.
 */

export interface NfoOptions {
  /**
   * Turns a provider image path into a URL. Used only for actor photos: Plex shows them only when
   * the NFO carries a URL, whereas posters and fanart are read from local image files. Without
   * it, no `<thumb>` is written.
   */
  readonly imageUrl?: (path: string) => string;
}

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n';
const INDENT = '    ';

interface XmlNode {
  readonly tag: string;
  readonly attributes?: Readonly<Record<string, string>>;
  /** Either text or children; text wins. */
  readonly text?: string;
  readonly children?: readonly XmlNode[];
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Whether XML 1.0 allows this code point; a lone surrogate arrives as a single code unit. */
function isLegalXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function escapeXml(value: string): string {
  let out = '';
  for (const char of value.replace(/\r\n?/g, '\n')) {
    const code = char.codePointAt(0) ?? 0;
    if (!isLegalXmlChar(code)) continue;
    out += ESCAPES[char] ?? char;
  }
  return out;
}

function serialize(node: XmlNode, depth: number): string {
  const pad = INDENT.repeat(depth);
  const attributes = Object.entries(node.attributes ?? {})
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('');
  if (node.text !== undefined) {
    return `${pad}<${node.tag}${attributes}>${escapeXml(node.text)}</${node.tag}>\n`;
  }
  const inner = (node.children ?? []).map((child) => serialize(child, depth + 1)).join('');
  return `${pad}<${node.tag}${attributes}>\n${inner}${pad}</${node.tag}>\n`;
}

/** A leaf, or nothing when the value is absent or blank: an empty tag would blank a field in Kodi. */
function leaf(
  tag: string,
  value: string | number | undefined,
  attributes?: Record<string, string>,
): XmlNode[] {
  if (value === undefined) return [];
  if (typeof value === 'number' && !Number.isFinite(value)) return [];
  const text = String(value).trim();
  if (text === '') return [];
  return [{ tag, text, ...(attributes ? { attributes } : {}) }];
}

const repeated = (tag: string, values: readonly string[] | undefined): XmlNode[] =>
  (values ?? []).flatMap((value) => leaf(tag, value));

function ratingNode(name: string, rating: Rating, isDefault: boolean): XmlNode {
  return {
    tag: 'rating',
    attributes: { name, max: '10', ...(isDefault && { default: 'true' }) },
    children: [
      ...leaf('value', rating.value.toFixed(2)),
      ...leaf('votes', Math.round(rating.votes)),
    ],
  };
}

const usable = (rating: Rating | undefined): rating is Rating =>
  rating !== undefined && Number.isFinite(rating.value) && Number.isFinite(rating.votes);

/** TMDB's rating stays the default; IMDb's, when the server has it, is listed beside it. */
function ratings(rating: Rating | undefined, imdb?: Rating): XmlNode[] {
  const nodes = [
    ...(usable(rating) ? [ratingNode('themoviedb', rating, true)] : []),
    ...(usable(imdb) ? [ratingNode('imdb', imdb, !usable(rating))] : []),
  ];
  return nodes.length > 0 ? [{ tag: 'ratings', children: nodes }] : [];
}

/** The IMDb id an NFO names (`<uniqueid type="imdb">tt…</uniqueid>`), if it names one. */
export function imdbIdOf(xml: string): string | undefined {
  return /<uniqueid\b[^>]*\btype="imdb"[^>]*>\s*(tt\d+)\s*<\/uniqueid>/.exec(xml)?.[1];
}

/**
 * An NFO this module wrote, with IMDb's rating added in place: what `renderMovieNfo` would give
 * for the same details with that rating, so the file reads as if it had been written with the
 * setting on. `undefined` when there is nothing to do (it already has one, the rating is
 * unusable) or nowhere sensible to put it (not the shape this module writes).
 */
export function addImdbRating(xml: string, imdb: Rating): string | undefined {
  if (!usable(imdb) || xml.includes('name="imdb"')) {
    return undefined;
  }
  const lineStart = (index: number): number => xml.lastIndexOf('\n', index) + 1;
  const lineEnd = (index: number): number => {
    const end = xml.indexOf('\n', index);
    return end === -1 ? xml.length : end + 1;
  };

  const close = xml.indexOf('</ratings>');
  if (close !== -1) {
    const open = xml.lastIndexOf('<ratings>', close);
    const isDefault = open === -1 || !/<rating\b[^>]*\bdefault="true"/.test(xml.slice(open, close));
    const at = lineStart(close);
    return xml.slice(0, at) + serialize(ratingNode('imdb', imdb, isDefault), 2) + xml.slice(at);
  }
  // Where the writer puts the block: after the show's title, else the original title, else the title.
  const after = ['</showtitle>', '</originaltitle>', '</title>']
    .map((tag) => xml.indexOf(tag))
    .find((index) => index !== -1);
  if (after === undefined) {
    return undefined;
  }
  const at = lineEnd(after);
  return (
    xml.slice(0, at) +
    serialize({ tag: 'ratings', children: [ratingNode('imdb', imdb, true)] }, 1) +
    xml.slice(at)
  );
}

/**
 * `<mpaa>`, the one rating tag Plex and Jellyfin read. A bare number (`16`, `-18`, `18+`) means
 * nothing without its country, so it gets one (`FR:16`, `FR:-18`); `PG-13` and `TV-MA` already say
 * where they come from. The separator is not `-`, which TMDB's own `-18` would double.
 */
function mpaa(certification: Certification | undefined): XmlNode[] {
  if (!certification) return [];
  const value = certification.value.trim();
  return leaf('mpaa', /^-?\d+\+?$/.test(value) ? `${certification.country}:${value}` : value);
}

/** `2021-09-15` gives `2021`; anything else gives nothing rather than a guess. */
function yearOf(date: string | undefined): string | undefined {
  return date !== undefined && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 4) : undefined;
}

function uniqueIds(details: MovieDetails | SeriesDetails): XmlNode[] {
  return [
    ...leaf('uniqueid', details.id.id, { type: 'tmdb', default: 'true' }),
    ...leaf('uniqueid', details.imdbId, { type: 'imdb' }),
    ...(details.kind === 'series' ? leaf('uniqueid', details.tvdbId, { type: 'tvdb' }) : []),
  ];
}

function actors(cast: readonly Person[], options: NfoOptions): XmlNode[] {
  return cast.flatMap((person) => {
    const name = leaf('name', person.name);
    if (name.length === 0) return [];
    const thumb =
      person.profilePath && options.imageUrl
        ? leaf('thumb', options.imageUrl(person.profilePath))
        : [];
    return [
      {
        tag: 'actor',
        children: [...name, ...leaf('role', person.role), ...leaf('order', person.order), ...thumb],
      },
    ];
  });
}

function document(roots: readonly XmlNode[]): string {
  return HEADER + roots.map((root) => serialize(root, 0)).join('');
}

export function renderMovieNfo(details: MovieDetails, options: NfoOptions = {}): string {
  const collection = details.collection;
  return document([
    {
      tag: 'movie',
      children: [
        ...leaf('title', details.title),
        ...leaf('originaltitle', details.originalTitle),
        ...ratings(details.rating, details.imdbRating),
        ...leaf('plot', details.overview),
        ...leaf('tagline', details.tagline),
        ...leaf('runtime', details.runtime),
        ...mpaa(details.certification),
        ...leaf('id', details.id.id),
        ...uniqueIds(details),
        ...repeated('genre', details.genres),
        ...repeated('country', details.countries),
        ...(collection && leaf('name', collection.name).length > 0
          ? [
              {
                tag: 'set',
                // Kodi's own attribute, which Plex's NFO agent and Jellyfin read to tell two
                // collections of one name apart. The short form (`<set>Name</set>`) is left
                // out: Plex's agent does not read it.
                ...(collection.id && { attributes: { tmdbcolid: String(collection.id.id) } }),
                children: [
                  ...leaf('name', collection.name),
                  ...leaf('overview', collection.overview),
                ],
              },
            ]
          : []),
        ...repeated('credits', details.writers),
        ...repeated('director', details.directors),
        ...leaf('premiered', details.releaseDate),
        ...leaf('year', yearOf(details.releaseDate)),
        ...repeated('studio', details.studios),
        ...repeated('tag', details.tags),
        ...actors(details.cast, options),
      ],
    },
  ]);
}

export function renderSeriesNfo(details: SeriesDetails, options: NfoOptions = {}): string {
  return document([
    {
      tag: 'tvshow',
      children: [
        ...leaf('title', details.title),
        ...leaf('originaltitle', details.originalTitle),
        ...leaf('showtitle', details.title),
        ...ratings(details.rating, details.imdbRating),
        ...leaf('plot', details.overview),
        ...leaf('tagline', details.tagline),
        ...mpaa(details.certification),
        ...leaf('id', details.id.id),
        ...uniqueIds(details),
        ...repeated('genre', details.genres),
        ...repeated('country', details.countries),
        ...leaf('premiered', details.firstAirDate),
        ...leaf('year', yearOf(details.firstAirDate)),
        ...leaf('status', details.status),
        ...repeated('studio', details.studios),
        ...repeated('tag', details.tags),
        ...actors(details.cast, options),
        ...details.seasons.flatMap((season) =>
          leaf('namedseason', season.name, { number: String(season.season) }),
        ),
      ],
    },
  ]);
}

/**
 * One `<episodedetails>` per episode, concatenated: Kodi's way to describe a file holding several
 * episodes. Season and episode are written even for a single one, where they are redundant.
 */
export function renderEpisodeNfo(
  series: SeriesDetails,
  episodes: readonly EpisodeInfo[],
  // Kept for symmetry with the other renderers: an episode NFO carries no actor photo.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: NfoOptions = {},
): string {
  return document(
    episodes.map((episode) => ({
      tag: 'episodedetails',
      children: [
        ...leaf('title', episode.title),
        ...leaf('showtitle', series.title),
        ...leaf('season', episode.season),
        ...leaf('episode', episode.episode),
        ...ratings(episode.rating),
        ...leaf('plot', episode.overview),
        ...leaf('runtime', episode.runtime),
        ...repeated('credits', episode.writers),
        ...repeated('director', episode.directors),
        ...leaf('aired', episode.airDate),
      ],
    })),
  );
}
