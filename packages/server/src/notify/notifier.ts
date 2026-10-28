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
import { PlexClient, type Logger, type RefreshReport, type RefreshTarget } from './plex.js';

/** What a target hears about when it does not say: the news, and what went wrong. */
const DEFAULT_EVENTS: readonly NotificationEvent[] = ['transferred', 'failed'];

export interface NotifierDeps {
  readonly config: Config;
  readonly translate: Translate;
  readonly log: Logger & { error(error: unknown): void };
  readonly delivery?: DeliveryOptions;
  readonly now?: () => Date;
}

export interface TestResult {
  /** Where it went, without the secret part of a URL. */
  readonly target: string;
  readonly kind: 'webhook' | 'plex' | 'jellyfin';
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
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
    if (plex && !config.apiKey?.plex) {
      log.warn('notify.plex is set without apiKey.plex: Plex will not be asked to refresh');
    }
    if (jellyfin && !config.apiKey?.jellyfin) {
      log.warn(
        'notify.jellyfin is set without apiKey.jellyfin: Jellyfin will not be asked to refresh',
      );
    }
    this.plex =
      plex && config.apiKey?.plex
        ? new PlexClient({ ...plex, token: config.apiKey.plex }, (r) => this.send(r), log)
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
        if (result.ok) {
          this.deps.log.info(`Notified ${where}: ${notification.event}`);
        } else {
          this.deps.log.warn(
            `Notification to ${where} failed after ${result.attempts} attempt(s): ${result.error ?? result.status}`,
          );
        }
      });
    }
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
    const list = [...targets.values()];
    if (this.plex) {
      const plex = this.plex;
      this.track(async () => {
        const report = await plex.refresh(list);
        this.deps.log.info(
          `Plex: ${report.refreshed} refresh(es), ${report.skipped.length} skipped, ${report.failed.length} failed`,
        );
      });
    }
    if (this.jellyfin) {
      const jellyfin = this.jellyfin;
      this.track(async () => {
        const report = await jellyfin.refresh(list);
        this.deps.log.info(
          `Jellyfin: ${report.refreshed} refresh(es), ${report.skipped.length} skipped, ${report.failed.length} failed`,
        );
      });
    }
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
