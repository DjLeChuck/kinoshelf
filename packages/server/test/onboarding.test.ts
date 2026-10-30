import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

interface Body {
  completed: boolean;
  steps: { id: string; state: string; auto: boolean }[];
}

const stateOf = (body: Body, id: string): string | undefined =>
  body.steps.find((step) => step.id === id)?.state;

describe('first-launch setup', () => {
  it('starts with nothing done on a bare install', async () => {
    const h = await harness();
    const body = (await h.request('GET', '/api/onboarding')).json<Body>();
    expect(body.completed).toBe(false);
    // The harness configures a destination; nothing else is settled.
    expect(body.steps.map((s) => s.state)).toEqual(['todo', 'todo', 'done', 'todo']);
  });

  it('keeps a mark across requests and takes it back on reopen', async () => {
    const h = await harness();
    await h.request('PATCH', '/api/onboarding', { step: 'server', state: 'skipped' });
    expect(stateOf((await h.request('GET', '/api/onboarding')).json<Body>(), 'server')).toBe(
      'skipped',
    );
    const reopened = await h.request('PATCH', '/api/onboarding', { step: 'server', state: null });
    expect(stateOf(reopened.json<Body>(), 'server')).toBe('todo');
  });

  it('finishes the welcome page on request', async () => {
    const h = await harness();
    const response = await h.request('PATCH', '/api/onboarding', { finished: true });
    expect(response.json<Body>().completed).toBe(true);
  });

  it('refuses a patch that names nothing', async () => {
    const h = await harness();
    expect((await h.request('PATCH', '/api/onboarding', {})).statusCode).toBe(400);
    expect(
      (await h.request('PATCH', '/api/onboarding', { step: 'nope', state: 'done' })).statusCode,
    ).toBe(400);
  });

  it('ticks the source step and completes once a job exists', async () => {
    const h = await harness();
    const source = await makeDir();
    await put(join(source, 'Dune.2021.1080p.mkv'));
    await h.request('POST', '/api/jobs', { path: source });
    await h.app.jobs.idle();
    const body = (await h.request('GET', '/api/onboarding')).json<Body>();
    expect(stateOf(body, 'source')).toBe('done');
    expect(body.completed).toBe(true);
  });

  it('needs a session', async () => {
    const h = await harness();
    const response = await h.app.inject({ method: 'GET', url: '/api/onboarding' });
    expect(response.statusCode).toBe(401);
  });
});
