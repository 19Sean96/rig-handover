// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night, folded from its lines in file order. Times keep the log's offset.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  // Sorted by job, so the page and the JSON share one order (ADR 0001).
  rows: DigestRow[];
  // Lines that didn't parse into a run. Counted, never thrown.
  badLines: number;
};

// null when runs/<night>.jsonl doesn't exist; an empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
