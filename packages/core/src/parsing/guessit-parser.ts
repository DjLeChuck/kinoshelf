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
// guessit already folds `UK` into `GB`; only a plain two-letter code is trusted.
// An explicit marker that a number is a season/episode: `S02E05`, `2x05`, `Season 2`, `Épisode 5`.
const EPISODE_MARKER =
  /s\d+\s*[-.]?\s*e\d+|\b\d{1,2}x\d{2,3}\b|saison|season|[ée]pisode|\bep?\s?\d/i;
/**
 * `A B-C D`: a dash glued to both sides, with at least two words each. `Spider-Man` and
 * `X-Men Days Of Future Past` have a word on one side, and are one title.
 */
function otherTitlesOf(title: string): readonly string[] {
  for (let at = title.indexOf('-'); at !== -1; at = title.indexOf('-', at + 1)) {
    const [left, right] = [title.slice(0, at), title.slice(at + 1)];
    if (
      /\S$/.test(left) &&
      /^\S/.test(right) &&
      [left, right].every((half) => /\S\s+\S/.test(half.trim()))
    ) {
      return [left.trim(), right.trim()];
    }
  }
  return [];
}

const countryOf = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : undefined;

/** {@link Parser} backed by guessit-js, which already understands parent-folder context. */
export class GuessitParser implements Parser {
  private readonly contextDepth: number;

  constructor(options: GuessitParserOptions = {}) {
    this.contextDepth = options.contextDepth ?? 3;
  }

  /** `undefined` when guessit gives up on the input. */
  private guess(
    segments: readonly string[],
    options?: { type: 'movie' },
  ): GuessItResult | undefined {
    try {
      return guessit(segments.map((segment) => segment.replace(TAG, '')).join('/'), options);
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

    // With a folder in the way guessit may take the folder for the title and push the file's
    // own leading words into `episode_title` (`Lego Ninjago/Saison 11/new/Ninjago_S12E02.mkv`
    // reads as "new"). The file name alone then names the show better, but only its title is
    // borrowed: the year and the rest still come from the folder (`Fondation (2021)/Foundation.S01E01`).
    const fileName = context.slice(-1);
    if (context.length > 1) {
      const alone = this.guess(fileName);
      const aloneTitle = text(alone?.title);
      const contextTitle = text(guess.title);
      if (aloneTitle !== undefined && contextTitle !== aloneTitle) {
        const flat = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const [file, folder, base] = [
          flat(aloneTitle),
          flat(contextTitle ?? ''),
          flat(fileName[0] ?? ''),
        ];
        const pushedAside = toList(guess.episode_title).map((t) => text(t)?.toLowerCase());
        // The file must *start* with that title (`Ninjago_S12E02…`; in `05 - Breakage` the same
        // words are the episode's title), and the two titles must not be one inside the other:
        // `Bref` for the folder and `Bref 2` for the file are the same show, season 2.
        const unrelated = !file.startsWith(folder) && !folder.startsWith(file);
        if (pushedAside.includes(aloneTitle.toLowerCase()) && base.startsWith(file) && unrelated) {
          guess = { ...guess, title: aloneTitle };
        }
      }
    }

    // A number with no marker that reassembles from season and episode (`2049` = S20E49, `116` =
    // S01E16) is not necessarily an episode. A year-like one is part of a title (`Blade Runner
    // 2049`), so the file is a movie. Any other could equally be an absolute episode number
    // (`Dragon Ball 116`), which cannot be told from S01E16: the type is left unknown.
    const base = fileName[0] ?? '';
    const [seasonList, episodeList] = [toList(guess.season), toList(guess.episode)];
    let numbersAreAmbiguous = false;
    // A "season" between 1900 and 2099 is a year (`Mulan 2 (...) (2004)` reads as S2004E02).
    const seasonIsYear =
      guess.type === 'episode' &&
      seasonList.length === 1 &&
      (seasonList[0] ?? 0) >= 1900 &&
      (seasonList[0] ?? 0) <= 2099;
    if (seasonIsYear) {
      if (EPISODE_MARKER.test(base)) {
        numbersAreAmbiguous = true;
      } else {
        guess = this.guess(context, { type: 'movie' }) ?? guess;
      }
    } else if (
      guess.type === 'episode' &&
      seasonList.length === 1 &&
      episodeList.length === 1 &&
      !EPISODE_MARKER.test(base)
    ) {
      const token = (seasonList[0] ?? 0) * 100 + (episodeList[0] ?? 0);
      if (base.includes(String(token))) {
        if (token >= 1900 && token <= 2099) {
          guess = this.guess(context, { type: 'movie' }) ?? guess;
        } else {
          numbersAreAmbiguous = true;
        }
      }
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
    const country = countryOf(guess.country);
    const subtitle = text(guess.alternative_title);
    // guessit calls it a volume (`Vol.2`) or a part (`Part.2`); a title names it either way.
    const volume = count(guess.volume) ?? count(guess.part);
    const otherTitles = title === undefined ? [] : otherTitlesOf(title);
    let kind: ParsedKind = 'unknown';
    if (title !== undefined && !numbersAreAmbiguous) {
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
      ...(kind === 'movie' && subtitle !== undefined && { subtitle }),
      ...(otherTitles.length > 0 && { otherTitles }),
      ...(year !== undefined && { year }),
      ...(kind === 'movie' && volume !== undefined && { volume }),
      ...(kind === 'episode' && season !== undefined && { season }),
      ...(kind === 'episode' && episodeTitle !== undefined && { episodeTitle }),
      ...(extension && { extension }),
      ...(knownIds.length > 0 && { knownIds }),
      ...(country !== undefined && { country }),
      ...(releaseGroup !== undefined && { releaseGroup }),
      ...(languages.length > 0 && { languages }),
    };
  }
}
