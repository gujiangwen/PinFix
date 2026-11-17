import type Database from "better-sqlite3";
import { ulid } from "ulid";

export type CheckpointStatus = "suspended" | "resumed" | "consumed";

/** R4: max checkpoints per session (default 20). */
export const DEFAULT_CHECKPOINT_MAX_PER_SESSION = 20;

export type SessionCheckpoint = {
  id: string;
  session_id: string;
  project_id: string;
  /** R8: bind resume to this repo path. */
  repo_path: string;
  issue_ids: string[];
  plan_json: unknown | null;
  refine_ir: unknown | null;
  wip_commit: string | null;
  graph_state: unknown | null;
  status: CheckpointStatus;
  note: string | null;
  created_at: number;
  updated_at: number;
};

type Row = {
  id: string;
  session_id: string;
  project_id: string;
  repo_path: string;
  issue_ids: string;
  plan_json: string | null;
  refine_ir: string | null;
  wip_commit: string | null;
  graph_state: string | null;
  status: CheckpointStatus;
  note: string | null;
  created_at: number;
  updated_at: number;
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function rowToCheckpoint(row: Row): SessionCheckpoint {
  return {
    id: row.id,
    session_id: row.session_id,
    project_id: row.project_id,
    repo_path: row.repo_path ?? "",
    issue_ids: parseJson<string[]>(row.issue_ids) ?? [],
    plan_json: parseJson(row.plan_json),
    refine_ir: parseJson(row.refine_ir),
    wip_commit: row.wip_commit,
    graph_state: parseJson(row.graph_state),
    status: row.status,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function countCheckpointsForSession(
  db: Database.Database,
  sessionId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM session_checkpoints WHERE session_id = ?`,
    )
    .get(sessionId) as { c: number };
  return row?.c ?? 0;
}

/**
 * R4: create checkpoint; if at/over N, evict oldest non-consumed first, else oldest.
 * Throws if still over after eviction attempt with force=false and max exceeded.
 */
export function createCheckpoint(
  db: Database.Database,
  input: {
    session_id: string;
    project_id: string;
    repo_path: string;
    issue_ids?: string[];
    plan_json?: unknown | null;
    refine_ir?: unknown | null;
    wip_commit?: string | null;
    graph_state?: unknown | null;
    note?: string | null;
    max_per_session?: number;
  },
): SessionCheckpoint {
  const max = input.max_per_session ?? DEFAULT_CHECKPOINT_MAX_PER_SESSION;
  let count = countCheckpointsForSession(db, input.session_id);
  while (count >= max) {
    const oldest = db
      .prepare(
        `SELECT id FROM session_checkpoints
         WHERE session_id = ?
         ORDER BY
           CASE status WHEN 'consumed' THEN 0 WHEN 'resumed' THEN 1 ELSE 2 END,
           created_at ASC
         LIMIT 1`,
      )
      .get(input.session_id) as { id: string } | undefined;
    if (!oldest) break;
    db.prepare(`DELETE FROM session_checkpoints WHERE id = ?`).run(oldest.id);
    count = countCheckpointsForSession(db, input.session_id);
  }

  const now = Date.now();
  const id = ulid();
  db.prepare(
    `INSERT INTO session_checkpoints (
      id, session_id, project_id, repo_path, issue_ids, plan_json, refine_ir,
      wip_commit, graph_state, status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'suspended', ?, ?, ?)`,
  ).run(
    id,
    input.session_id,
    input.project_id,
    input.repo_path,
    JSON.stringify(input.issue_ids ?? []),
    input.plan_json != null ? JSON.stringify(input.plan_json) : null,
    input.refine_ir != null ? JSON.stringify(input.refine_ir) : null,
    input.wip_commit ?? null,
    input.graph_state != null ? JSON.stringify(input.graph_state) : null,
    input.note ?? null,
    now,
    now,
  );
  return getCheckpoint(db, id)!;
}

export function getCheckpoint(
  db: Database.Database,
  id: string,
): SessionCheckpoint | undefined {
  const row = db
    .prepare(`SELECT * FROM session_checkpoints WHERE id = ?`)
    .get(id) as Row | undefined;
  return row ? rowToCheckpoint(row) : undefined;
}

export function listCheckpoints(
  db: Database.Database,
  opts: {
    session_id?: string;
    project_id?: string;
    limit?: number;
    offset?: number;
  } = {},
): SessionCheckpoint[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.session_id) {
    where.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.project_id) {
    where.push("project_id = ?");
    params.push(opts.project_id);
  }
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT * FROM session_checkpoints
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Row[];
  return rows.map(rowToCheckpoint);
}

/**
 * R8: resume only when project_id + repo_path match; else return mismatch.
 */
export function resumeCheckpoint(
  db: Database.Database,
  id: string,
  bind: { project_id: string; repo_path: string },
):
  | { ok: true; checkpoint: SessionCheckpoint }
  | { ok: false; code: "not_found" | "bind_mismatch" | "not_suspended"; checkpoint?: SessionCheckpoint } {
  const cp = getCheckpoint(db, id);
  if (!cp) return { ok: false, code: "not_found" };
  if (cp.project_id !== bind.project_id || cp.repo_path !== bind.repo_path) {
    return { ok: false, code: "bind_mismatch", checkpoint: cp };
  }
  if (cp.status !== "suspended") {
    return { ok: false, code: "not_suspended", checkpoint: cp };
  }
  const now = Date.now();
  db.prepare(
    `UPDATE session_checkpoints SET status = 'resumed', updated_at = ? WHERE id = ?`,
  ).run(now, id);
  return { ok: true, checkpoint: getCheckpoint(db, id)! };
}

export function consumeCheckpoint(
  db: Database.Database,
  id: string,
): SessionCheckpoint | undefined {
  const now = Date.now();
  db.prepare(
    `UPDATE session_checkpoints SET status = 'consumed', updated_at = ? WHERE id = ?`,
  ).run(now, id);
  return getCheckpoint(db, id);
}

/**
 * R4 GC: delete consumed and/or older than maxAgeMs.
 * Returns number deleted.
 */
export function gcCheckpoints(
  db: Database.Database,
  opts: {
    session_id?: string;
    project_id?: string;
    consumed?: boolean;
    max_age_ms?: number;
  } = {},
): number {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.session_id) {
    where.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.project_id) {
    where.push("project_id = ?");
    params.push(opts.project_id);
  }
  const parts: string[] = [];
  if (opts.consumed !== false) {
    parts.push(`status = 'consumed'`);
  }
  if (opts.max_age_ms != null) {
    parts.push(`created_at < ?`);
    params.push(Date.now() - opts.max_age_ms);
  }
  if (!parts.length) {
    parts.push(`status = 'consumed'`);
  }
  where.push(`(${parts.join(" OR ")})`);
  const info = db
    .prepare(
      `DELETE FROM session_checkpoints WHERE ${where.join(" AND ")}`,
    )
    .run(...params);
  return info.changes;
}
