import type { paths } from './api-schema.js';

export type Diagnostic =
  paths['/api/diagnostic']['get']['responses'][200]['content']['application/json'];

export const ISSUES_URL = 'https://github.com/DjLeChuck/kinoshelf/issues/new';

/** The versions, as a block to paste into a bug report. */
export function versionsText(summary: Diagnostic['summary']): string {
  return [
    `Kinoshelf ${summary.kinoshelf}`,
    `Node ${summary.node} (${summary.platform})`,
    `ffprobe ${summary.ffprobe ?? 'not installed'}`,
  ].join('\n');
}

/** An issue form with the versions already in it, and a reminder to attach the archive. */
export function issueUrl(summary: Diagnostic['summary'], reminder: string): string {
  const body = `${reminder}\n\n\`\`\`\n${versionsText(summary)}\n\`\`\`\n`;
  return `${ISSUES_URL}?body=${encodeURIComponent(body)}`;
}
