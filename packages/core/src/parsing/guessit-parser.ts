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

// guessit-js types most fields as scalars but returns arrays when it finds conflicting
// candidates (a folder name it half-reads as a title next to the file's own title). Anything
// that is not the expected type is treated as absent rather than trusted.
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** {@link Parser} backed by guessit-js, which already understands parent-folder context. */
export class GuessitParser implements Parser {
  private readonly contextDepth: number;

  constructor(options: GuessitParserOptions = {}) {
    this.contextDepth = options.contextDepth ?? 3;
  }

  /** `undefined` when guessit gives up on the input. */
  private guess(segments: readonly string[]): GuessItResult | undefined {
    try {
      return guessit(segments.map((segment) => segment.replace(TAG, '')).join('/'));
    } catch (error) {
      if (error instanceof GuessItException) {
        return undefined;
      }
      throw error;
    }
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

    let guess = this.guess(context);
    // Conflicting titles usually come from a folder name: the file name alone is then the
    // better witness (`Dune.mkv` in a folder called `Xy-G0wEL`).
    if (guess && text(guess.title) === undefined && context.length > 1) {
      guess = this.guess(context.slice(-1)) ?? guess;
    }
    if (!guess) {
      return { path, kind: 'unknown', episodes: [] };
    }

    const seasons = toList(guess.season);
    const episodes = [...new Set(toList(guess.episode))].sort((a, b) => a - b);
    const season = seasons.length === 1 ? seasons[0] : undefined;
    const extension = extname(path).slice(1).toLowerCase();
    const languages = toList(guess.language).flatMap((l) => languageCode(l) ?? []);

    // Date-based and absolute-numbered episodes are out of scope for v1: they carry no
    // season/episode pair, so they stay `unknown` rather than being guessed at.
    const title = text(guess.title);
    const year = count(guess.year);
    const episodeTitle = text(guess.episode_title);
    const releaseGroup = text(guess.release_group);
    let kind: ParsedKind = 'unknown';
    if (title !== undefined) {
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
      ...(title !== undefined && { title }),
      ...(year !== undefined && { year }),
      ...(kind === 'episode' && season !== undefined && { season }),
      ...(kind === 'episode' && episodeTitle !== undefined && { episodeTitle }),
      ...(extension && { extension }),
      ...(knownIds.length > 0 && { knownIds }),
      ...(releaseGroup !== undefined && { releaseGroup }),
      ...(languages.length > 0 && { languages }),
    };
  }
}
