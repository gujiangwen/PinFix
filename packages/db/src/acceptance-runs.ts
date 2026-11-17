import type Database from "better-sqlite3";
import type {
  AcceptanceReport,
  AcceptanceRunStatus,
  AcceptanceRunSummary,
  ScenarioIR,
} from "@sightloop/shared";
import { ulid } from "ulid";

type RunRow = {
  id: string;
  session_id: string;
  project_id: string;
  status: AcceptanceRunStatus;
  scenario_json: string;
  report_json: string | null;
  start_url: string;
  temp_commit_sha: string | null;
  fingerprint: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
};

function parseReport(raw: string | null): AcceptanceReport | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AcceptanceReport;
  } catch {
    return null;
  }
}

function rowToSummary(row: RunRow, includeReport = false): AcceptanceRunSummary {
  return {
    id: row.id,
    session_id: row.session_id,
    project_id: row.project_id,
    status: row.status,
    start_url: row.start_url,
    fingerprint: row.fingerprint,
    temp_commit_sha: row.temp_commit_sha,
    error: row.error,
    started_at: row.started_at,
    finished_at: row.finished_at,
    created_at: row.created_at,
    ...(includeReport ? { report: parseReport(row.report_json) } : {}),
  };
}

export function createAcceptanceRun(
  db: Database.Database,
  input: {
    session_id: string;
    project_id: string;
    scenario: ScenarioIR;
    start_url: string;
    temp_commit_sha?: string | null;
    fingerprint?: string | null;
  },
): AcceptanceRunSummary {
  const id = ulid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO acceptance_runs (
      id, session_id, project_id, status, scenario_json, report_json,
      start_url, temp_commit_sha, fingerprint, error, started_at, finished_at, created_at
    ) VALUES (?, ?, ?, 'queued', ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?)`,
  ).run(
    id,
    input.session_id,
    input.project_id,
    JSON.stringify(input.scenario),
    input.start_url,
    input.temp_commit_sha ?? null,
    input.fingerprint ?? null,
    now,
  );
  return getAcceptanceRun(db, id)!;
}

export function getAcceptanceRun(
  db: Database.Database,
  id: string,
): AcceptanceRunSummary | undefined {
  const row = db
    .prepare(`SELECT * FROM acceptance_runs WHERE id = ?`)
    .get(id) as RunRow | undefined;
  return row ? rowToSummary(row, true) : undefined;
}

export function listAcceptanceRuns(
  db: Database.Database,
  sessionId: string,
  limit = 10,
): AcceptanceRunSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM acceptance_runs
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(sessionId, limit) as RunRow[];
  return rows.map((r) => rowToSummary(r, false));
}

export function getLatestAcceptanceRun(
  db: Database.Database,
  sessionId: string,
): AcceptanceRunSummary | undefined {
  const row = db
    .prepare(
      `SELECT * FROM acceptance_runs
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(sessionId) as RunRow | undefined;
  return row ? rowToSummary(row, true) : undefined;
}

export function updateAcceptanceRun(
  db: Database.Database,
  id: string,
  patch: {
    status?: AcceptanceRunStatus;
    report?: AcceptanceReport | null;
    error?: string | null;
    started_at?: number | null;
    finished_at?: number | null;
  },
): AcceptanceRunSummary | undefined {
  const existing = getAcceptanceRun(db, id);
  if (!existing) return undefined;
  const row = db
    .prepare(`SELECT * FROM acceptance_runs WHERE id = ?`)
    .get(id) as RunRow;
  db.prepare(
    `UPDATE acceptance_runs SET
      status = ?,
      report_json = ?,
      error = ?,
      started_at = ?,
      finished_at = ?
     WHERE id = ?`,
  ).run(
    patch.status ?? row.status,
    patch.report !== undefined
      ? patch.report
        ? JSON.stringify(patch.report)
        : null
      : row.report_json,
    patch.error !== undefined ? patch.error : row.error,
    patch.started_at !== undefined ? patch.started_at : row.started_at,
    patch.finished_at !== undefined ? patch.finished_at : row.finished_at,
    id,
  );
  return getAcceptanceRun(db, id);
}

export function setSessionAcceptanceCache(
  db: Database.Database,
  sessionId: string,
  runId: string | null,
  status: string | null,
): void {
  db.prepare(
    `UPDATE sessions SET
      last_acceptance_run_id = ?,
      last_acceptance_status = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(runId, status, Date.now(), sessionId);
}

export type BaselineRow = {
  id: string;
  project_id: string;
  fingerprint: string;
  meta_json: string;
  dir_relpath: string;
  updated_at: number;
  created_at: number;
};

export function getBaseline(
  db: Database.Database,
  projectId: string,
  fingerprint: string,
): BaselineRow | undefined {
  return db
    .prepare(
      `SELECT * FROM acceptance_baselines
       WHERE project_id = ? AND fingerprint = ?`,
    )
    .get(projectId, fingerprint) as BaselineRow | undefined;
}

export function upsertBaseline(
  db: Database.Database,
  input: {
    project_id: string;
    fingerprint: string;
    meta: unknown;
    dir_relpath: string;
  },
): BaselineRow {
  const existing = getBaseline(db, input.project_id, input.fingerprint);
  const now = Date.now();
  if (existing) {
    db.prepare(
      `UPDATE acceptance_baselines SET
        meta_json = ?, dir_relpath = ?, updated_at = ?
       WHERE id = ?`,
    ).run(JSON.stringify(input.meta), input.dir_relpath, now, existing.id);
    return getBaseline(db, input.project_id, input.fingerprint)!;
  }
  const id = ulid();
  db.prepare(
    `INSERT INTO acceptance_baselines (
      id, project_id, fingerprint, meta_json, dir_relpath, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.fingerprint,
    JSON.stringify(input.meta),
    input.dir_relpath,
    now,
    now,
  );
  return getBaseline(db, input.project_id, input.fingerprint)!;
}
