import type { MovieDetails, Person, Rating, SeriesDetails } from '../types/details.js';
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

function ratings(rating: Rating | undefined): XmlNode[] {
  if (!rating || !Number.isFinite(rating.value) || !Number.isFinite(rating.votes)) return [];
  return [
    {
      tag: 'ratings',
      children: [
        {
          tag: 'rating',
          attributes: { name: 'themoviedb', max: '10', default: 'true' },
          children: [
            ...leaf('value', rating.value.toFixed(2)),
            ...leaf('votes', Math.round(rating.votes)),
          ],
        },
      ],
    },
  ];
}

/** `2021-09-15` gives `2021`; anything else gives nothing rather than a guess. */
function yearOf(date: string | undefined): string | undefined {
  return date !== undefined && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 4) : undefined;
}

function uniqueIds(details: MovieDetails | SeriesDetails): XmlNode[] {
  return [
    ...leaf('uniqueid', details.id.id, { type: 'tmdb', default: 'true' }),
    ...leaf('uniqueid', details.imdbId, { type: 'imdb' }),
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
        ...ratings(details.rating),
        ...leaf('plot', details.overview),
        ...leaf('tagline', details.tagline),
        ...leaf('runtime', details.runtime),
        ...leaf('id', details.id.id),
        ...uniqueIds(details),
        ...repeated('genre', details.genres),
        ...repeated('country', details.countries),
        ...(collection && leaf('name', collection.name).length > 0
          ? [
              {
                tag: 'set',
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
        ...ratings(details.rating),
        ...leaf('plot', details.overview),
        ...leaf('tagline', details.tagline),
        ...leaf('id', details.id.id),
        ...uniqueIds(details),
        ...repeated('genre', details.genres),
        ...repeated('country', details.countries),
        ...leaf('premiered', details.firstAirDate),
        ...leaf('year', yearOf(details.firstAirDate)),
        ...leaf('status', details.status),
        ...repeated('studio', details.studios),
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
