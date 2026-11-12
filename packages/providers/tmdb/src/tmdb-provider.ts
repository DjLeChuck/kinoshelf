import {
  KinoshelfError,
  type CollectionInfo,
  type ExternalId,
  type ImageSize,
  type MovieDetails,
  type Person,
  type Rating,
  type SeriesDetails,
  type MetadataProvider,
  type MovieCandidate,
  type SearchQuery,
  type SeasonInfo,
  type SeriesCandidate,
  type ImageCandidate,
  type WorkImages,
} from '@kinoshelf/core';
import { movieRating, pickCertification } from './certification.js';
import { TmdbClient, type TmdbClientOptions } from './client.js';
import {
  collectionSchema,
  movieAlternativeTitlesSchema,
  movieFullDetailsSchema,
  episodeImagesSchema,
  imagesSchema,
  type ImageList,
  movieSearchSchema,
  seasonSchema,
  tvAlternativeTitlesSchema,
  tvFullDetailsSchema,
  tvSearchSchema,
  type MovieResult,
  type TvResult,
} from './schemas.js';

export interface TmdbProviderOptions extends TmdbClientOptions {
  /** Used when a query gives no language, e.g. `fr` or `en-US`. */
  readonly language?: string;
  /**
   * Alternative titles cost one request per candidate, so only the best-ranked results get
   * them (they are cached afterwards).
   */
  readonly alternativeTitlesFor?: number;
  /** Where images are fetched from (`KINOSHELF_TMDB_IMAGES_URL`), TMDB's own server by default. */
  readonly imagesUrl?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_TTL_MS = DAY_MS;
// New episodes appear in a season over time: keep this short so they are found.
const SEASON_TTL_MS = DAY_MS;
const ALTERNATIVE_TITLES_TTL_MS = 30 * DAY_MS;
const DETAIL_TTL_MS = DAY_MS;

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * An image path as TMDB gives it (`/kqjL17yufvn9OVLyXYpvtyrFfak.jpg`). Anything else is dropped:
 * it ends up in a URL that is downloaded and written next to a video.
 */
const IMAGE_PATH = /^\/[A-Za-z0-9]{1,64}\.(jpg|png)$/;
function imageField<K extends string>(
  key: K,
  path: string | null | undefined,
): Partial<Record<K, string>> {
  return path != null && IMAGE_PATH.test(path) ? ({ [key]: path } as Record<K, string>) : {};
}
// Sizes TMDB serves: w185 is enough for a list, w780 for a poster file.
/** Only what can be written next to a video: an SVG logo is dropped, as in `pickLogo`. */
const imageCandidates = (list: ImageList): ImageCandidate[] =>
  (list ?? [])
    .filter((image) => IMAGE_PATH.test(image.file_path))
    .map((image) => {
      const rating = ratingOf(image.vote_average, image.vote_count);
      return {
        path: image.file_path,
        ...(image.iso_639_1 && { language: image.iso_639_1 }),
        width: image.width,
        height: image.height,
        ...(rating && { rating }),
      };
    });

const IMAGE_SIZES: Record<ImageSize, string> = {
  preview: 'w185',
  standard: 'w780',
  original: 'original',
};
// An NFO lists the main cast; TMDB sends hundreds of people for a long-running series.
const CAST_LIMIT = 20;
const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story']);

/** TMDB reports 0 and 0 votes for a work nobody rated: that is no rating, not a zero. */
const ratingOf = (average?: number | null, votes?: number | null): Rating | undefined =>
  average != null && votes != null && votes > 0 ? { value: average, votes } : undefined;

const crewNames = (
  crew: readonly { name: string; job?: string | null | undefined }[] | null | undefined,
  jobs: ReadonlySet<string>,
): string[] => [
  ...new Set((crew ?? []).filter((c) => c.job != null && jobs.has(c.job)).map((c) => c.name)),
];

/** Names of a list of `{ name }`, blanks and repeats left out. */
interface Logo {
  file_path: string;
  iso_639_1?: string | null | undefined;
  vote_average?: number | null | undefined;
  width?: number | null | undefined;
}

/** `fr-FR` asks for French images: the language part alone. */
const primaryLanguage = (language: string | undefined): string =>
  language?.split('-')[0]?.toLowerCase() ?? '';

/**
 * The languages TMDB is asked for logos in (`include_image_language`): the metadata language, then
 * English, then the textless ones.
 */
const logoLanguages = (language: string | undefined): string =>
  [...new Set([primaryLanguage(language), 'en', 'null'])].filter(Boolean).join(',');

/**
 * The logo to write: the metadata language first, then English, then a textless one, then any other
 * language (only seen when the first three gave none), and within a language the best voted (the
 * widest breaks a tie). A file that is not a PNG or JPEG is dropped.
 */
function pickLogo(
  logos: readonly Logo[] | null | undefined,
  language: string | undefined,
): string | undefined {
  const wanted = primaryLanguage(language);
  const rank = (logo: Logo): number =>
    logo.iso_639_1 === wanted ? 0 : logo.iso_639_1 === 'en' ? 1 : logo.iso_639_1 === null ? 2 : 3;
  return [...(logos ?? [])]
    .filter((logo) => IMAGE_PATH.test(logo.file_path))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.vote_average ?? 0) - (a.vote_average ?? 0) ||
        (b.width ?? 0) - (a.width ?? 0),
    )[0]?.file_path;
}

/** Whether the languages asked for gave a logo that can be written. */
const hasLogo = (logos: readonly Logo[] | null | undefined): boolean =>
  (logos ?? []).some((logo) => IMAGE_PATH.test(logo.file_path));

const names = (items: readonly { name: string }[] | null | undefined): string[] => [
  ...new Set((items ?? []).map((i) => i.name.trim()).filter((n) => n !== '')),
];

const yearOf = (date: string | null | undefined): number | undefined => {
  const year = date ? /^(\d{4})/.exec(date)?.[1] : undefined;
  return year === undefined ? undefined : Number(year);
};

/** Titles different from the ones already known, without duplicates. */
const extraTitles = (titles: readonly string[], known: readonly string[]): string[] => [
  ...new Set(titles.filter((title) => !known.includes(title))),
];

/** Whether a TMDB `release_date` (`YYYY-MM-DD`) is set and not after today. */
const isReleased = (releaseDate: string | null | undefined): boolean =>
  !!releaseDate && releaseDate <= new Date().toISOString().slice(0, 10);

export class TmdbProvider implements MetadataProvider {
  readonly name = 'tmdb';
  private readonly client: TmdbClient;
  private readonly language: string | undefined;
  private readonly alternativeTitlesFor: number;
  private readonly imagesUrl: string;

  constructor(options: TmdbProviderOptions) {
    this.client = new TmdbClient(options);
    this.language = options.language;
    this.alternativeTitlesFor = options.alternativeTitlesFor ?? 5;
    this.imagesUrl = (options.imagesUrl ?? IMAGE_BASE).replace(/\/+$/, '');
  }

  async searchMovies(query: SearchQuery): Promise<readonly MovieCandidate[]> {
    const response = await this.client.get(
      '/3/search/movie',
      {
        query: query.title,
        year: query.year,
        language: query.language ?? this.language,
        include_adult: 'false',
      },
      movieSearchSchema,
      { ttlMs: SEARCH_TTL_MS },
    );

    return Promise.all(
      (response?.results ?? []).map((result, index) =>
        this.movieCandidate(result, index < this.alternativeTitlesFor),
      ),
    );
  }

  async getMovieDetails(id: ExternalId, language?: string): Promise<MovieDetails | null> {
    this.requireOwn(id);
    // One request for everything: credits and external ids come with the details.
    const r = await this.client.get(
      `/3/movie/${id.id}`,
      {
        language: language ?? this.language,
        append_to_response: 'credits,external_ids,keywords,release_dates,images',
        include_image_language: logoLanguages(language ?? this.language),
      },
      movieFullDetailsSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    if (!r) {
      return null;
    }
    const rating = ratingOf(r.vote_average, r.vote_count);
    const certification = pickCertification(
      (r.release_dates?.results ?? []).map((c) => ({
        country: c.iso_3166_1,
        value: movieRating(c.release_dates),
      })),
      language ?? this.language,
    );
    return {
      kind: 'movie',
      id: { provider: this.name, id: r.id },
      title: r.title,
      originalTitle: r.original_title,
      ...this.commonDetails(r, language ?? this.language),
      ...(!hasLogo(r.images?.logos) &&
        (await this.anyLogo(id, 'movie', language ?? this.language))),
      tags: names(r.keywords?.keywords),
      ...(certification && { certification }),
      ...(r.imdb_id && { imdbId: r.imdb_id }),
      ...(rating && { rating }),
      ...(r.release_date && { releaseDate: r.release_date }),
      ...(r.runtime != null && r.runtime > 0 && { runtime: r.runtime }),
      directors: crewNames(r.credits?.crew, new Set(['Director'])),
      writers: crewNames(r.credits?.crew, WRITER_JOBS),
      ...(r.belongs_to_collection && {
        collection: {
          id: { provider: this.name, id: r.belongs_to_collection.id },
          name: r.belongs_to_collection.name,
        },
      }),
    };
  }

  async getCollection(id: ExternalId, language?: string): Promise<CollectionInfo | null> {
    this.requireOwn(id);
    const r = await this.client.get(
      `/3/collection/${String(id.id)}`,
      { language: language ?? this.language },
      collectionSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    if (!r) {
      return null;
    }
    return {
      id: { provider: this.name, id: r.id },
      name: r.name,
      ...(r.overview?.trim() && { overview: r.overview.trim() }),
      // A part with no release date or one still to come (a rumoured or planned film) is not
      // counted: a library could never hold it, so the collection would read as incomplete forever.
      // The collection endpoint gives no status, and one request per part would cost too much.
      parts: (r.parts ?? [])
        .filter((part) => isReleased(part.release_date))
        .map((part) => {
          const year = /^\d{4}/.exec(part.release_date ?? '')?.[0];
          return {
            id: { provider: this.name, id: part.id },
            title: part.title,
            ...(year && { year: Number(year) }),
          };
        }),
    };
  }

  async getSeriesDetails(id: ExternalId, language?: string): Promise<SeriesDetails | null> {
    this.requireOwn(id);
    const r = await this.client.get(
      `/3/tv/${id.id}`,
      {
        language: language ?? this.language,
        append_to_response: 'credits,external_ids,keywords,content_ratings,images',
        include_image_language: logoLanguages(language ?? this.language),
      },
      tvFullDetailsSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    if (!r) {
      return null;
    }
    const rating = ratingOf(r.vote_average, r.vote_count);
    const imdbId = r.external_ids?.imdb_id;
    const tvdbId = r.external_ids?.tvdb_id;
    const certification = pickCertification(
      (r.content_ratings?.results ?? []).map((c) => ({ country: c.iso_3166_1, value: c.rating })),
      language ?? this.language,
    );
    return {
      kind: 'series',
      id: { provider: this.name, id: r.id },
      title: r.name,
      originalTitle: r.original_name,
      ...this.commonDetails(r, language ?? this.language),
      ...(!hasLogo(r.images?.logos) &&
        (await this.anyLogo(id, 'series', language ?? this.language))),
      tags: names(r.keywords?.results),
      ...(certification && { certification }),
      ...(imdbId && { imdbId }),
      ...(rating && { rating }),
      ...(r.first_air_date && { firstAirDate: r.first_air_date }),
      ...(r.status && { status: r.status }),
      ...(tvdbId && { tvdbId }),
      seasons: (r.seasons ?? []).map((s) => ({
        season: s.season_number,
        ...(s.name && { name: s.name }),
        ...imageField('posterPath', s.poster_path),
      })),
    };
  }

  /**
   * Every image of a work, in every language: with no `include_image_language` TMDB answers them
   * all, which the dialog sorts and filters by language. The automatic logo falls back on it too,
   * so both share one cached request.
   */
  private allImages(id: ExternalId, kind: 'movie' | 'series') {
    return this.client.get(
      `/3/${kind === 'movie' ? 'movie' : 'tv'}/${id.id}/images`,
      {},
      imagesSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
  }

  /**
   * The logo of a work that has none in the languages asked for (a Chinese series, say): the best
   * of any language, as a last resort. A logo in a foreign language beats none, and the dialog can
   * still replace it.
   */
  private async anyLogo(id: ExternalId, kind: 'movie' | 'series', language: string | undefined) {
    return imageField('logoPath', pickLogo((await this.allImages(id, kind))?.logos, language));
  }

  async listImages(id: ExternalId, kind: 'movie' | 'series'): Promise<WorkImages | null> {
    this.requireOwn(id);
    const r = await this.allImages(id, kind);
    if (!r) {
      return null;
    }
    return {
      poster: imageCandidates(r.posters),
      fanart: imageCandidates(r.backdrops),
      logo: imageCandidates(r.logos),
    };
  }

  async listEpisodeImages(
    id: ExternalId,
    season: number,
    episode: number,
  ): Promise<readonly ImageCandidate[] | null> {
    this.requireOwn(id);
    const r = await this.client.get(
      `/3/tv/${String(id.id)}/season/${String(season)}/episode/${String(episode)}/images`,
      {},
      episodeImagesSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    return r ? imageCandidates(r.stills) : null;
  }

  imageUrl(path: string, size: ImageSize): string {
    return `${this.imagesUrl}/${IMAGE_SIZES[size]}${path}`;
  }

  /** The fields movies and series share, whatever their TMDB spelling. */
  private commonDetails(
    r: {
      overview?: string | null | undefined;
      tagline?: string | null | undefined;
      poster_path?: string | null | undefined;
      backdrop_path?: string | null | undefined;
      genres?: readonly { name: string }[] | null | undefined;
      production_companies?: readonly { name: string }[] | null | undefined;
      production_countries?: readonly { name: string }[] | null | undefined;
      credits?:
        | {
            cast?:
              | readonly {
                  name: string;
                  character?: string | null | undefined;
                  order?: number | null | undefined;
                  profile_path?: string | null | undefined;
                }[]
              | null
              | undefined;
          }
        | null
        | undefined;
      images?: { logos?: readonly Logo[] | null | undefined } | null | undefined;
    },
    language: string | undefined,
  ) {
    const cast: Person[] = (r.credits?.cast ?? []).slice(0, CAST_LIMIT).map((p) => ({
      name: p.name,
      ...(p.character && { role: p.character }),
      ...(p.order != null && { order: p.order }),
      ...imageField('profilePath', p.profile_path),
    }));
    return {
      genres: (r.genres ?? []).map((g) => g.name),
      studios: (r.production_companies ?? []).map((c) => c.name),
      countries: (r.production_countries ?? []).map((c) => c.name),
      cast,
      ...(r.overview && { overview: r.overview }),
      ...(r.tagline && { tagline: r.tagline }),
      ...imageField('posterPath', r.poster_path),
      ...imageField('backdropPath', r.backdrop_path),
      ...imageField('logoPath', pickLogo(r.images?.logos, language)),
    };
  }

  private async movieCandidate(
    result: MovieResult,
    withAlternatives: boolean,
  ): Promise<MovieCandidate> {
    const alternatives = withAlternatives
      ? await this.client.get(
          `/3/movie/${result.id}/alternative_titles`,
          {},
          movieAlternativeTitlesSchema,
          { ttlMs: ALTERNATIVE_TITLES_TTL_MS, nullOn404: true },
        )
      : null;
    const year = yearOf(result.release_date);
    return {
      kind: 'movie',
      id: { provider: this.name, id: result.id },
      title: result.title,
      originalTitle: result.original_title,
      alternativeTitles: extraTitles(alternatives?.titles.map((t) => t.title) ?? [], [
        result.title,
        result.original_title,
      ]),
      ...(year !== undefined && { year }),
      ...(result.overview && { overview: result.overview }),
      ...imageField('posterPath', result.poster_path),
      ...(result.popularity != null && { popularity: result.popularity }),
    };
  }

  async searchSeries(query: SearchQuery): Promise<readonly SeriesCandidate[]> {
    const response = await this.client.get(
      '/3/search/tv',
      {
        query: query.title,
        first_air_date_year: query.year,
        language: query.language ?? this.language,
        include_adult: 'false',
      },
      tvSearchSchema,
      { ttlMs: SEARCH_TTL_MS },
    );

    return Promise.all(
      (response?.results ?? []).map((result, index) =>
        this.seriesCandidate(result, index < this.alternativeTitlesFor),
      ),
    );
  }

  private async seriesCandidate(
    result: TvResult,
    withAlternatives: boolean,
  ): Promise<SeriesCandidate> {
    const alternatives = withAlternatives
      ? await this.client.get(
          `/3/tv/${result.id}/alternative_titles`,
          {},
          tvAlternativeTitlesSchema,
          { ttlMs: ALTERNATIVE_TITLES_TTL_MS, nullOn404: true },
        )
      : null;
    const year = yearOf(result.first_air_date);
    return {
      kind: 'series',
      id: { provider: this.name, id: result.id },
      title: result.name,
      originalTitle: result.original_name,
      alternativeTitles: extraTitles(alternatives?.results.map((t) => t.title) ?? [], [
        result.name,
        result.original_name,
      ]),
      ...(year !== undefined && { year }),
      ...(result.overview && { overview: result.overview }),
      ...imageField('posterPath', result.poster_path),
      ...(result.popularity != null && { popularity: result.popularity }),
      ...(result.origin_country &&
        result.origin_country.length > 0 && { countries: result.origin_country }),
    };
  }

  async getSeason(
    seriesId: ExternalId,
    season: number,
    language?: string,
  ): Promise<SeasonInfo | null> {
    this.requireOwn(seriesId);

    const response = await this.client.get(
      `/3/tv/${seriesId.id}/season/${season}`,
      { language: language ?? this.language },
      seasonSchema,
      { ttlMs: SEASON_TTL_MS, nullOn404: true },
    );

    return (
      response && {
        season: response.season_number,
        episodes: response.episodes.map((episode) => {
          const directors = crewNames(episode.crew, new Set(['Director']));
          const writers = crewNames(episode.crew, WRITER_JOBS);
          const rating = ratingOf(episode.vote_average, episode.vote_count);
          return {
            season: episode.season_number,
            episode: episode.episode_number,
            ...(episode.name && { title: episode.name }),
            ...(episode.air_date && { airDate: episode.air_date }),
            ...(episode.overview && { overview: episode.overview }),
            ...(episode.runtime != null && episode.runtime > 0 && { runtime: episode.runtime }),
            ...(directors.length > 0 && { directors }),
            ...(writers.length > 0 && { writers }),
            ...(rating && { rating }),
            ...imageField('stillPath', episode.still_path),
          };
        }),
      }
    );
  }

  private requireOwn(id: ExternalId): void {
    if (id.provider !== this.name) {
      throw new KinoshelfError('provider.foreign-id', {
        expected: this.name,
        received: id.provider,
      });
    }
  }
}
