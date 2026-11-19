import { expect, test } from '@playwright/test';
import { navLink, signIn } from './helpers.js';

// A real task is too short to catch: the list is the server's to say, so it is faked here and the
// page is asked to show it wherever the person goes.
const task = (fields: object): object => ({
  id: 'scan:job-1',
  kind: 'scan',
  code: 'scan',
  params: { name: 'Films', phase: 'identify' },
  status: 'running',
  done: 4,
  total: 10,
  current: 'Dune (2021).mkv',
  href: '/libraries',
  error: null,
  ...fields,
});

test('shows the tasks that run on every page, and keeps a failure until it is closed', async ({
  page,
}) => {
  let tasks: object[] = [task({})];
  await page.route('**/api/activity', (route) => route.fulfill({ json: { tasks } }));
  // The panel reads the list on a server event, and a real server sends none at the moment the test
  // changes it. A stream that says `ready` and closes is opened again by the browser after `retry`,
  // which makes the page read the list again, whatever else the server is doing.
  await page.route('**/api/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'retry: 300\nevent: ready\ndata: {}\n\n',
    }),
  );
  await signIn(page);

  const panel = page.getByRole('complementary', { name: 'Background activity' });
  await expect(panel.getByRole('button', { name: /1 task running/ })).toBeVisible();

  // Details are folded away until asked for, and follow the person to another page.
  await panel.getByRole('button', { name: /1 task running/ }).click();
  await expect(panel.getByText('Scan of Films')).toBeVisible();
  await expect(panel.getByText('4 of 10')).toBeVisible();
  await navLink(page, 'History').click();
  await expect(page).toHaveURL(/\/history/);
  await expect(panel.getByText('Scan of Films')).toBeVisible();

  // It ends in failure: the cause stays, with a way to close it.
  tasks = [
    task({
      status: 'failed',
      error: { code: 'internal.unexpected' },
      done: null,
      total: null,
      current: null,
    }),
  ];
  await expect(panel.getByText(/✗/)).toBeVisible();
  await panel.getByRole('button', { name: 'Dismiss' }).click();
  await expect(panel).toHaveCount(0);
});
