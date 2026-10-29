import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const run = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

const NORMAL = '2026-10-27';
const EMPTY = '2026-10-26';
const BAD = '2026-10-25';
const MISSING = '2026-10-24';

let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  // Jobs written out of order so the sort is visible.
  const normal = [
    run('2026-10-27T01:00:00+01:00', 'zeta/ok', 'ok', 'rook'),
    run('2026-10-27T01:01:00+01:00', 'alpha/flaky', 'retry', 'rook', 'upstream 503'),
    run('2026-10-27T01:02:00+01:00', 'alpha/flaky', 'retry', 'rook', 'upstream 503'),
    run('2026-10-27T01:03:00+01:00', 'alpha/flaky', 'retry', 'rook', 'upstream 503'),
    run('2026-10-27T01:04:00+01:00', 'alpha/flaky', 'ok', 'rook'),
    run('2026-10-27T01:05:00+01:00', 'mid/broken', 'fail', 'sean', 'quota exceeded'),
    run('2026-10-27T01:06:00+01:00', 'nobody/owned', 'ok', null),
  ];
  writeFileSync(join(dir, `${NORMAL}.jsonl`), normal.join('\n') + '\n');
  writeFileSync(join(dir, `${EMPTY}.jsonl`), '');
  const bad = [
    run('2026-10-25T01:00:00+01:00', 'b/job', 'ok', 'rook'),
    '{"at":"2026-10-25T01:01:00+01:00","job":"a/jo', // truncated
    run('2026-10-25T01:02:00+01:00', 'a/job', 'ok', 'rook'),
  ];
  writeFileSync(join(dir, `${BAD}.jsonl`), bad.join('\n') + '\n');
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const jobsInHtml = (html: string) => [...html.matchAll(/<tr[^>]*><td>([^<]*)<\/td>/g)].map((m) => m[1]);

describe('GET /digest/:night', () => {
  it('renders a sorted table, warns on 3 retries or a fail, dashes missing values', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(jobsInHtml(html)).toEqual(['alpha/flaky', 'mid/broken', 'nobody/owned', 'zeta/ok']);
    expect(html).toMatch(/<tr class="warn"><td>alpha\/flaky<\/td>/);
    expect(html).toMatch(/<tr class="warn"><td>mid\/broken<\/td>/);
    expect(html).toMatch(/<tr><td>nobody\/owned<\/td><td>—<\/td>/);
    expect(html).toMatch(/<tr><td>zeta\/ok<\/td>/);
    expect(html).not.toContain('could not be read');
  });

  it('404s with a message for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${MISSING}`);
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('keeps valid rows and notes the bad line', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    expect(jobsInHtml(html)).toEqual(['a/job', 'b/job']);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Night object', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    const n = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(n.night).toBe(NORMAL);
    expect(n.counts).toEqual({ ok: 3, retry: 3, fail: 1 });
    expect(n.badLines).toBe(0);
    expect(n.rows.map((r) => r.job)).toEqual(['alpha/flaky', 'mid/broken', 'nobody/owned', 'zeta/ok']);
    expect(n.rows.find((r) => r.job === 'nobody/owned')).toMatchObject({ owner: null, lastError: null });
  });

  it('404s with an error body for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 });
  });

  it('counts the bad line and keeps valid rows', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    const n = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(n.badLines).toBe(1);
    expect(n.rows.map((r) => r.job)).toEqual(['a/job', 'b/job']);
  });
});

describe('page and JSON agree (ADR 0001)', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const n = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as Night;
    expect(jobsInHtml(html)).toEqual(n.rows.map((r) => r.job));
  });
});
