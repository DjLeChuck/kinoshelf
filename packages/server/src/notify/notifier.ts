import { dirname } from 'node:path';
import type { Config } from '@kinoshelf/core';
import type { Translate } from '@kinoshelf/i18n';
import type { Execution } from '../executions.js';
import type { Job } from '../jobs.js';
import { deliver, type DeliveryOptions, type DeliveryResult } from './delivery.js';
import { buildRequest, type HttpRequest, type WebhookConfig } from './formats.js';
import { JellyfinClient } from './jellyfin.js';
import {
  executionFailedNotification,
  jobFailedNotification,
  reviewNotification,
  testNotification,
  transferredNotification,
  type ErrorBody,
  type ExecutionOutcome,
  type Notification,
  type NotificationEvent,
} from './message.js';
import { redactUrl } from './paths.js';
import {
  PlexClient,
  type Logger,
  type PlexTokenSource,
  type RefreshReport,
  type RefreshTarget,
} from './plex.js';

/** What a target hears about when it does not say: the news, and what went wrong. */
const DEFAULT_EVENTS: readonly NotificationEvent[] = ['transferred', 'failed'];

export interface NotifierDeps {
  readonly config: Config;
  readonly translate: Translate;
  readonly log: Logger & { error(error: unknown): void };
  readonly delivery?: DeliveryOptions;
  readonly now?: () => Date;
  /** The Plex sign-in, when the user did not type a token (see `PlexSession`). */
  readonly plexSession?: PlexTokenSource & { readonly account: { readonly connected: boolean } };
}

export interface TestResult {
  /** Where it went, without the secret part of a URL. */
  readonly target: string;
  readonly kind: 'webhook' | 'plex' | 'jellyfin';
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
}

/** How many outcomes `recent` keeps: a page of them, no more. */
const RECENT_LIMIT = 20;

/** One notification, or one refresh of a media server, and how it went. */
export interface DeliveryRecord {
  /** ISO 8601. */
  readonly at: string;
  readonly kind: 'webhook' | 'plex' | 'jellyfin';
  /** Where it went, without the secret part of a URL. */
  readonly target: string;
  /** The notification's event, or `refresh` for a media server. */
  readonly event: string;
  readonly ok: boolean;
  /** Webhooks only: the sends a delivery took (three at most). */
  readonly attempts?: number;
  readonly status?: number;
  /** What went wrong, never carrying a URL. */
  readonly error?: string;
  /** Media servers only: folders the refresh could not reach. */
  readonly failed?: number;
}

/**
 * Tells the targets of `notify` what happened, and asks the media servers to look at what was
 * transferred. Best effort by design: a target that is down costs a log line, never a transfer,
 * and nothing is kept for later, so a notification still waiting when the server stops is lost.
 */
export class Notifier {
  private webhooks: readonly WebhookConfig[] = [];
  private plex: PlexClient | undefined;
  private jellyfin: JellyfinClient | undefined;
  private translate: Translate;
  private readonly pending = new Set<Promise<void>>();
  /** Newest first, in memory: like the log, it starts again empty with the server. */
  private readonly outcomes: DeliveryRecord[] = [];

  constructor(private readonly deps: NotifierDeps) {
    this.translate = deps.translate;
    this.configure(deps.config);
  }

  /**
   * Rebuilds the targets from a configuration, so a change made in the UI applies at once. What
   * is already in flight keeps the clients it started with.
   */
  configure(config: Config, translate: Translate = this.translate): void {
    const { log } = this.deps;
    this.translate = translate;
    this.webhooks = config.notify?.webhooks ?? [];

    const { plex, jellyfin } = config.notify ?? {};
    // A token typed in the settings wins; otherwise the one the sign-in with Plex made.
    const session = this.deps.plexSession;
    const plexToken: string | PlexTokenSource | undefined =
      config.apiKey?.plex ?? (session?.account.connected === true ? session : undefined);
    if (plex && plexToken === undefined) {
      log.warn('notify.plex is set without a token: Plex will not be asked to refresh');
    }
    if (jellyfin && !config.apiKey?.jellyfin) {
      log.warn(
        'notify.jellyfin is set without apiKey.jellyfin: Jellyfin will not be asked to refresh',
      );
    }
    this.plex =
      plex && plexToken !== undefined
        ? new PlexClient({ ...plex, token: plexToken }, (r) => this.send(r), log)
        : undefined;
    this.jellyfin =
      jellyfin && config.apiKey?.jellyfin
        ? new JellyfinClient(
            { ...jellyfin, apiKey: config.apiKey.jellyfin },
            (r) => this.send(r),
            log,
          )
        : undefined;
  }

  get enabled(): boolean {
    return this.webhooks.length > 0 || this.plex !== undefined || this.jellyfin !== undefined;
  }

  /** The analysis of a job failed. */
  jobFailed(job: Job, error: ErrorBody): void {
    this.dispatch(jobFailedNotification(this.translate, job, error, this.now()));
  }

  /** The analysis finished: say so when files wait for a human. */
  jobDone(job: Job, counts: { ambiguous: number; unrecognized: number; conflict: number }): void {
    const { ambiguous, unrecognized, conflict } = counts;
    if (ambiguous + unrecognized + conflict > 0) {
      this.dispatch(
        reviewNotification(this.translate, job, { ambiguous, unrecognized, conflict }, this.now()),
      );
    }
  }

  /** A transfer ended, whole or in part: tell, and have the media servers look at what arrived. */
  executionFinished(job: Job, execution: Execution, outcome: ExecutionOutcome): void {
    const { done, failed } = outcome.summary;
    if (done + failed === 0) {
      return;
    }
    this.dispatch(transferredNotification(this.translate, job, execution, outcome, this.now()));
    if (done > 0) {
      this.refreshMediaServers(outcome);
    }
  }

  /** A transfer failed outright. Files may have been transferred before it did: look at those too. */
  executionFailed(job: Job, execution: Execution, error: ErrorBody): void {
    this.dispatch(executionFailedNotification(this.translate, job, execution, error, this.now()));
  }

  /** Whether anything is configured to talk to. */
  get targets(): { webhooks: number; plex: boolean; jellyfin: boolean } {
    return { webhooks: this.webhooks.length, plex: !!this.plex, jellyfin: !!this.jellyfin };
  }

  /** The last notifications and refreshes, newest first (since the server started). */
  recent(): readonly DeliveryRecord[] {
    return this.outcomes;
  }

  /** Asks the media servers to look at these folders (Kinoshelf's paths), and waits for them. */
  async refreshPaths(
    targets: readonly RefreshTarget[],
  ): Promise<{ plex?: RefreshReport; jellyfin?: RefreshReport }> {
    const [plex, jellyfin] = await Promise.all([
      this.plex?.refresh(targets),
      this.jellyfin?.refresh(targets),
    ]);
    return { ...(plex && { plex }), ...(jellyfin && { jellyfin }) };
  }

  /** Waits for what is in flight, so a closing server does not drop the last messages. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  /** Reaches every target once, whatever it listens to, and says how it went. */
  async test(): Promise<TestResult[]> {
    const notification = testNotification(this.translate, this.now());
    const outcome = (
      target: string,
      kind: TestResult['kind'],
      result: DeliveryResult,
    ): TestResult => ({
      target,
      kind,
      ok: result.ok,
      ...(result.status !== undefined && { status: result.status }),
      ...(result.error !== undefined && { error: result.error }),
    });
    return Promise.all([
      ...this.webhooks.map(async (webhook) =>
        outcome(
          redactUrl(webhook.url),
          'webhook',
          await this.send(buildRequest(webhook, notification)),
        ),
      ),
      ...(this.plex ? [this.plex.check().then((r) => outcome('plex', 'plex', r))] : []),
      ...(this.jellyfin
        ? [this.jellyfin.check().then((r) => outcome('jellyfin', 'jellyfin', r))]
        : []),
    ]);
  }

  private dispatch(notification: Notification): void {
    for (const webhook of this.webhooks) {
      if (!(webhook.on ?? DEFAULT_EVENTS).includes(notification.event as NotificationEvent)) {
        continue;
      }
      this.track(async () => {
        const result = await this.send(buildRequest(webhook, notification));
        const where = redactUrl(webhook.url);
        this.record({
          kind: 'webhook',
          target: where,
          event: notification.event,
          ok: result.ok,
          attempts: result.attempts,
          ...(result.status !== undefined && { status: result.status }),
          ...(result.error !== undefined && { error: result.error }),
        });
        if (result.ok) {
          // A webhook that needed a retry is worth knowing about before it stops answering.
          const retried = result.attempts > 1 ? ` after ${result.attempts} attempts` : '';
          this.deps.log.info(`Notified ${where}: ${notification.event}${retried}`);
        } else {
          this.deps.log.warn(
            `Notification to ${where} failed after ${result.attempts} attempt(s): ${result.error ?? result.status}`,
          );
        }
      });
    }
  }

  /**
   * Folders whose files changed without a transfer (an image replaced): the media servers keep
   * what they drew until they look again.
   */
  foldersChanged(targets: readonly RefreshTarget[]): void {
    this.refreshFolders(targets);
  }

  private refreshMediaServers(outcome: ExecutionOutcome): void {
    // The folder each file landed in (a movie's, a season's): enough for a media server to find it.
    const targets = new Map<string, RefreshTarget>();
    for (const file of outcome.files) {
      if (file.status === 'done' && file.destination !== null) {
        const path = dirname(file.destination);
        targets.set(path, { path, kind: file.kind });
      }
    }
    this.refreshFolders([...targets.values()]);
  }

  private refreshFolders(list: readonly RefreshTarget[]): void {
    if (this.plex) {
      const plex = this.plex;
      this.track(async () => {
        const report = await plex.refresh(list);
        this.recordRefresh('plex', report);
        this.deps.log.info(
          `Plex: ${report.refreshed} refresh(es), ${report.skipped.length} skipped, ${report.failed.length} failed`,
        );
      });
    }
    if (this.jellyfin) {
      const jellyfin = this.jellyfin;
      this.track(async () => {
        const report = await jellyfin.refresh(list);
        this.recordRefresh('jellyfin', report);
        this.deps.log.info(
          `Jellyfin: ${report.refreshed} refresh(es), ${report.skipped.length} skipped, ${report.failed.length} failed`,
        );
      });
    }
  }

  private recordRefresh(kind: 'plex' | 'jellyfin', report: RefreshReport): void {
    this.record({
      kind,
      target: kind,
      event: 'refresh',
      ok: report.failed.length === 0,
      failed: report.failed.length,
    });
  }

  private record(outcome: Omit<DeliveryRecord, 'at'>): void {
    this.outcomes.unshift({ at: this.now().toISOString(), ...outcome });
    this.outcomes.length = Math.min(this.outcomes.length, RECENT_LIMIT);
  }

  private send(request: HttpRequest): Promise<DeliveryResult> {
    return deliver(request, this.deps.delivery);
  }

  private track(task: () => Promise<void>): void {
    const promise = task()
      .catch((error: unknown) => {
        this.deps.log.error(error);
      })
      .finally(() => {
        this.pending.delete(promise);
      });
    this.pending.add(promise);
  }

  private now(): Date {
    return (this.deps.now ?? ((): Date => new Date()))();
  }
}
