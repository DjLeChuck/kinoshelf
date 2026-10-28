import { extname } from 'node:path';
import { GuessItException, guessit, type GuessItResult, type GuessitLanguage } from 'guessit-js';
import type { ExternalId, ParsedKind, ParsedMedia } from '../types/media.js';
import type { Parser } from '../types/parser.js';

export interface GuessitParserOptions {
  /**
   * How many trailing path segments are given to guessit (file name included). Three covers
   * `Show/Season 2/episode.mkv`; more would let a library root such as `TV Shows` leak into
   * the title.
   */
  readonly contextDepth?: number;
}

// Ids and editions embedded in names by Plex (`{tmdb-1}`, `{edition-X}`) and Jellyfin
// (`[tmdbid-1]`). guessit would read them as titles, so they are removed before parsing.
const TAG = /\s*[{[](?:tmdb|tvdb|imdb)(?:id)?-[^}\]]*[}\]]|\s*\{edition-[^}]*\}/gi;
const TMDB_TAG = /[{[]tmdb(?:id)?-(\d+)[}\]]/i;

const toList = <T>(value: T | readonly T[] | undefined): readonly T[] =>
  value === undefined ? [] : Array.isArray(value) ? (value as readonly T[]) : [value as T];

function languageCode(language: string | GuessitLanguage): string | undefined {
  return typeof language === 'string'
    ? language
    : (language.alpha2 ?? language.alpha3 ?? language.name);
}

/** {@link Parser} backed by guessit-js, which already understands parent-folder context. */
export class GuessitParser implements Parser {
  private readonly contextDepth: number;

  constructor(options: GuessitParserOptions = {}) {
    this.contextDepth = options.contextDepth ?? 3;
  }

  parse(path: string): ParsedMedia {
    const segments = path.split(/[\\/]+/).filter(Boolean);
    const context = segments.slice(-this.contextDepth);

    const knownIds: ExternalId[] = [];
    for (const segment of context) {
      const id = TMDB_TAG.exec(segment)?.[1];
      if (id !== undefined && !knownIds.some((known) => known.id === Number(id))) {
        knownIds.push({ provider: 'tmdb', id: Number(id) });
      }
    }

    let guess: GuessItResult;
    try {
      guess = guessit(context.map((segment) => segment.replace(TAG, '')).join('/'));
    } catch (error) {
      if (!(error instanceof GuessItException)) {
        throw error;
      }
      return { path, kind: 'unknown', episodes: [] };
    }

    const seasons = toList(guess.season);
    const episodes = [...new Set(toList(guess.episode))].sort((a, b) => a - b);
    const season = seasons.length === 1 ? seasons[0] : undefined;
    const extension = extname(path).slice(1).toLowerCase();
    const languages = toList(guess.language).flatMap((l) => languageCode(l) ?? []);

    // Date-based and absolute-numbered episodes are out of scope for v1: they carry no
    // season/episode pair, so they stay `unknown` rather than being guessed at.
    let kind: ParsedKind = 'unknown';
    if (guess.title !== undefined) {
      if (guess.type === 'movie') {
        kind = 'movie';
      } else if (guess.type === 'episode' && episodes.length > 0 && season !== undefined) {
        kind = 'episode';
      }
    }

    return {
      path,
      kind,
      episodes: kind === 'episode' ? episodes : [],
      ...(guess.title !== undefined && { title: guess.title }),
      ...(guess.year !== undefined && { year: guess.year }),
      ...(kind === 'episode' && season !== undefined && { season }),
      ...(kind === 'episode' &&
        guess.episode_title !== undefined && {
          episodeTitle: guess.episode_title,
        }),
      ...(extension && { extension }),
      ...(knownIds.length > 0 && { knownIds }),
      ...(guess.release_group !== undefined && { releaseGroup: guess.release_group }),
      ...(languages.length > 0 && { languages }),
    };
  }
}
