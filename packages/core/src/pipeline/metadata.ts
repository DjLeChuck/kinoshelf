import { candidateKey } from '../matching/score.js';
import { parseTemplate, templateVariables } from '../profiles/template.js';
import type { Details } from '../types/details.js';
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
    const details = this.writesCompanions ? await this.detailsOf(candidate) : null;
    if (details === null && !this.namesEpisodes) {
      return {};
    }
    if (candidate.kind !== 'series' || parsed.season === undefined) {
      return details ? { details } : {};
    }
    const season = await this.seasonOf(candidate, parsed.season);
    const episodes = (season?.episodes ?? []).filter((info) =>
      parsed.episodes.includes(info.episode),
    );
    return { ...(details && { details }), episodes };
  }

  private detailsOf(candidate: Candidate): Promise<Details | null> {
    const { provider, language } = this.options;
    const key = `${candidateKey(candidate)}:${language ?? ''}`;
    return this.shared(this.details, key, () =>
      candidate.kind === 'movie'
        ? provider.getMovieDetails(candidate.id, language)
        : provider.getSeriesDetails(candidate.id, language),
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
