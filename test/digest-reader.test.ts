import { describe, expect, it } from 'vitest';
import { digest, readNight } from '../src/digest/reader.js';

describe('run log reader', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('folds a job into one row, keeping the log offset', () => {
    const rows = readNight('runs', '2026-10-28')!.rows;
    expect(rows.find((r) => r.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(rows.find((r) => r.job === 'notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps a row whose owner is null', () => {
    const rows = readNight('runs', '2026-10-28')!.rows;
    expect(rows.find((r) => r.job === 'digest/render')).toMatchObject({ owner: null, runs: 1, lastError: null });
  });

  it('returns null for a night with no file, and no rows for an empty one', () => {
    expect(readNight('runs', '2026-01-01')).toBeNull();
    expect(readNight('runs', '../package')).toBeNull();
    expect(digest('2026-10-30', '')).toEqual({ night: '2026-10-30', rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 });
  });

  it('counts lines that parse but are not runs', () => {
    const text = ['{"at":"t","job":"a","status":"boom","owner":null}', '[]', 'null', '{"job":"a"}'].join('\n');
    expect(digest('n', text)).toEqual({ night: 'n', rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 4 });
  });
});
