import type { ExternalId } from '../types/media.js';
import { normalizeTitle } from './title-similarity.js';

/**
 * A title a human tied to one work (`Gordon Ramsay Hells Kitchen` is TMDB's `Hell's Kitchen`).
 * Movies are told apart by year as well, since the same title names several films; a series keeps
 * no year, as a file's one is only a weak hint.
 */
export interface TitleAlias {
  readonly kind: 'movie' | 'series';
  readonly title: string;
  readonly year?: number;
  readonly id: ExternalId;
}

export type AliasQuery = Pick<TitleAlias, 'kind' | 'title' | 'year'>;

/** What the matcher asks; the server answers from its database. Synchronous, as SQLite is. */
export interface AliasLookup {
  find(query: AliasQuery): ExternalId | undefined;
}

/** Titles that read the same once normalized share a key, so `Hells.Kitchen` finds `hells kitchen`. */
export function aliasKey({ kind, title, year }: AliasQuery): string {
  return `${kind}|${normalizeTitle(title)}|${kind === 'movie' ? (year ?? '') : ''}`;
}

/** A lookup over a fixed list: tests and the corpus. */
export class StaticAliases implements AliasLookup {
  private readonly byKey: Map<string, ExternalId>;

  constructor(aliases: readonly TitleAlias[]) {
    this.byKey = new Map(aliases.map((alias) => [aliasKey(alias), alias.id]));
  }

  find(query: AliasQuery): ExternalId | undefined {
    return this.byKey.get(aliasKey(query));
  }
}
