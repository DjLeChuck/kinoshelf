import type { NotifyConfig } from '@kinoshelf/core';
import type { Notification } from './message.js';

export type WebhookConfig = NonNullable<NotifyConfig['webhooks']>[number];

export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** Discord refuses a longer `content`. */
const DISCORD_LIMIT = 2000;

const isFailure = (notification: Notification): boolean => notification.event === 'failed';

/** What ntfy shows next to the title: a quick read of what kind of message it is. */
const NTFY_TAGS: Record<Notification['event'], string[]> = {
  transferred: ['white_check_mark'],
  failed: ['warning'],
  'needs-review': ['mag'],
  test: ['test_tube'],
};

/**
 * The request for one target. `generic` is Kinoshelf's own JSON, for a tool that routes on the
 * codes; the others fit the format of a notification service, a failure being the loud one.
 * The target's own `headers` win, for the key a service wants in one.
 */
export function buildRequest(target: WebhookConfig, notification: Notification): HttpRequest {
  const request = (
    headers: Record<string, string>,
    body: unknown,
    url = target.url,
  ): HttpRequest => ({
    method: 'POST',
    url,
    headers: { ...headers, ...target.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  switch (target.format ?? 'generic') {
    case 'gotify':
      // Priority is a number to Gotify; 8 is where phones make a sound.
      return request(JSON_HEADERS, {
        title: notification.title,
        message: notification.message,
        priority: isFailure(notification) ? 8 : 5,
      });
    case 'ntfy': {
      // JSON publishing goes to the server root and names the topic, which keeps accents and
      // symbols out of HTTP headers. The topic is the last segment of the URL.
      const topicUrl = new URL(target.url);
      const segments = topicUrl.pathname.split('/').filter(Boolean);
      const topic = segments.pop() ?? '';
      const root = new URL(`${topicUrl.origin}/${segments.join('/')}${segments.length ? '/' : ''}`);
      return request(
        JSON_HEADERS,
        {
          topic,
          title: notification.title,
          message: notification.message,
          priority: isFailure(notification) ? 4 : 3,
          tags: NTFY_TAGS[notification.event],
        },
        root.toString(),
      );
    }
    case 'discord': {
      const content = `**${notification.title}**\n${notification.message}`;
      return request(JSON_HEADERS, {
        content:
          content.length > DISCORD_LIMIT ? `${content.slice(0, DISCORD_LIMIT - 1)}…` : content,
      });
    }
    case 'generic':
      return request(JSON_HEADERS, notification);
  }
}
