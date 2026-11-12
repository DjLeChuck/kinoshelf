import { candidateKey } from '../matching/score.js';
import { parseTemplate, templateVariables } from '../profiles/template.js';
import type { CollectionInfo, Details, MovieDetails } from '../types/details.js';
import type { ExternalId } from '../types/media.js';
import type { ParsedMedia } from '../types/media.js';
import type { Profile } from '../types/profile.js';
import type { Candidate, EpisodeInfo, MetadataProvider, SeasonInfo } from '../types/provider.js';

export interface MetadataLoaderOptions {
  readonly provider: MetadataProvider;
  readonly profile: Profile;
  /** The language matching uses, so details read like the titles that were matched. */
  readonly language?: string;
}

/** What the planner needs to write a file's companions (see `PlanInput`). */
export interface LoadedMetadata {
  readonly details?: Details;
  /**
   * The provider's collection of a movie, with the movies it lists. It is the provider's even when
   * the owner overrode it: the library still needs it to count what is missing. `null` says the
   * movie was read and belongs to none (so a collection it left is forgotten); absent, nothing was
   * read (a series, or a profile that loads no details).
   */
  readonly collection?: CollectionInfo | null;
  readonly episodes?: readonly EpisodeInfo[];
}

/**
 * Fetches the details and episode records a profile's NFO and artwork are made of. The planner
 * stays off the network, so whoever plans goes through here first.
 *
 * Requests are shared per work and per season: a 200-episode series costs one details request,
 * and files matched concurrently wait for the same promise. A provider failure rejects (like in
 * matching) and is not cached, so a retry asks again.
 */
export class MetadataLoader {
  private readonly details = new Map<string, Promise<Details | null>>();
  private readonly seasons = new Map<string, Promise<SeasonInfo | null>>();
  private readonly collections = new Map<string, Promise<CollectionInfo | null>>();

  constructor(private readonly options: MetadataLoaderOptions) {}

  /**
   * False for a profile that writes neither and names no episode by its title: no request is
   * ever made then.
   */
  get needsMetadata(): boolean {
    return this.writesCompanions || this.namesEpisodes;
  }

  private get writesCompanions(): boolean {
    const { profile } = this.options;
    return profile.nfo !== null || profile.artwork.length > 0;
  }

  /** `{episodeTitle}` in the episode file name: it comes from the provider's season. */
  private get namesEpisodes(): boolean {
    return templateVariables(parseTemplate(this.options.profile.templates.episodeFile)).includes(
      'episodeTitle',
    );
  }

  async forCandidate(candidate: Candidate, parsed: ParsedMedia): Promise<LoadedMetadata> {
    if (!this.needsMetadata) {
      return {};
    }
    const loaded = this.writesCompanions ? await this.detailsOf(candidate) : null;
    const { details = null, collection } = loaded ?? {};
    if (details === null && !this.namesEpisodes) {
      return {};
    }
    if (candidate.kind !== 'series' || parsed.season === undefined) {
      return details ? { details, ...(collection !== undefined && { collection }) } : {};
    }
    const season = await this.seasonOf(candidate, parsed.season);
    const episodes = (season?.episodes ?? []).filter((info) =>
      parsed.episodes.includes(info.episode),
    );
    return { ...(details && { details }), episodes };
  }

  private async detailsOf(
    candidate: Candidate,
  ): Promise<{ details: Details; collection?: CollectionInfo | null } | null> {
    const { provider, language } = this.options;
    const key = `${candidateKey(candidate)}:${language ?? ''}`;
    const details = await this.shared(this.details, key, () =>
      candidate.kind === 'movie'
        ? provider.getMovieDetails(candidate.id, language)
        : provider.getSeriesDetails(candidate.id, language),
    );
    if (details?.kind !== 'movie') {
      return details && { details };
    }
    if (!details.collection?.id) {
      return { details, collection: null };
    }
    // The movie names its collection but not its overview, nor the movies it lists: one request
    // per collection, shared by the movies of the saga.
    const collection = await this.collectionOf(details.collection.id);
    if (!collection) {
      // The movie names it, the provider does not know it (any more): the library still files the
      // movie under it, with nothing to count.
      const { id, name } = details.collection;
      return { details, collection: { id, name, parts: [] } };
    }
    const named: MovieDetails = {
      ...details,
      collection: {
        ...details.collection,
        ...(collection.overview !== undefined && { overview: collection.overview }),
      },
    };
    return { details: named, collection };
  }

  private collectionOf(id: ExternalId): Promise<CollectionInfo | null> {
    const { provider, language } = this.options;
    return this.shared(this.collections, `${id.provider}:${String(id.id)}:${language ?? ''}`, () =>
      provider.getCollection(id, language),
    );
  }

  private seasonOf(candidate: Candidate, season: number): Promise<SeasonInfo | null> {
    const { provider, language } = this.options;
    const key = `${candidateKey(candidate)}:${season}:${language ?? ''}`;
    return this.shared(this.seasons, key, () => provider.getSeason(candidate.id, season, language));
  }

  private shared<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    let pending = cache.get(key);
    if (!pending) {
      pending = load();
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    return pending;
  }
}
