import type Database from "better-sqlite3";
import type { AuditEvent, Metrics } from "@sightloop/shared";
import { ulid } from "ulid";
import { isVecReady } from "./vectors.js";

type AuditRow = {
  id: string;
  project_id: string | null;
  session_id: string | null;
  event: string;
  detail_json: string | null;
  created_at: number;
};

function rowToAudit(row: AuditRow): AuditEvent {
  let detail: unknown = null;
  if (row.detail_json) {
    try {
      detail = JSON.parse(row.detail_json) as unknown;
    } catch {
      detail = row.detail_json;
    }
  }
  return {
    id: row.id,
    project_id: row.project_id,
    session_id: row.session_id,
    event: row.event,
    detail,
    created_at: row.created_at,
  };
}

export function insertAudit(
  db: Database.Database,
  event: string,
  detail: unknown,
  projectId?: string | null,
  sessionId?: string | null,
): AuditEvent {
  const item: AuditEvent = {
    id: ulid(),
    project_id: projectId ?? null,
    session_id: sessionId ?? null,
    event,
    detail: detail ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO audit_log (id, project_id, session_id, event, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.project_id,
    item.session_id,
    item.event,
    JSON.stringify(detail ?? {}),
    item.created_at,
  );
  return item;
}

export function listAudit(
  db: Database.Database,
  opts: {
    project_id?: string;
    session_id?: string;
    limit?: number;
  } = {},
): AuditEvent[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.project_id) {
    where.push("project_id = ?");
    params.push(opts.project_id);
  }
  if (opts.session_id) {
    where.push("session_id = ?");
    params.push(opts.session_id);
  }
  const limit = opts.limit ?? 100;
  const sql = `SELECT * FROM audit_log
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as AuditRow[];
  return rows.map(rowToAudit);
}

export function getMetrics(db: Database.Database): Metrics & {
  vec_ready: boolean;
  vec_indexed: number;
} {
  const sessionsTotal = (
    db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }
  ).n;

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM sessions GROUP BY status`,
    )
    .all() as Array<{ status: string; n: number }>;
  const sessions_by_status: Record<string, number> = {};
  for (const r of statusRows) sessions_by_status[r.status] = r.n;

  const failed = sessions_by_status.failed ?? 0;
  const failure_rate = sessionsTotal === 0 ? 0 : failed / sessionsTotal;

  const avgRow = db
    .prepare(
      `SELECT AVG(step_count) AS avg_steps FROM sessions WHERE step_count > 0`,
    )
    .get() as { avg_steps: number | null };
  const avg_steps = Number(avgRow.avg_steps ?? 0);

  const knowledge_total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM knowledge WHERE archived IS NULL OR archived = 0`,
      )
      .get() as { n: number }
  ).n;
  const knowledge_pinned = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM knowledge WHERE pinned = 1 AND (archived IS NULL OR archived = 0)`,
      )
      .get() as { n: number }
  ).n;
  const audit_total = (
    db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }
  ).n;

  const reviewRows = db
    .prepare(
      `SELECT decision, COUNT(*) AS n FROM reviews GROUP BY decision`,
    )
    .all() as Array<{ decision: string; n: number }>;
  const reviews_by_decision: Record<string, number> = {};
  for (const r of reviewRows) reviews_by_decision[r.decision] = r.n;

  let vec_indexed = 0;
  try {
    vec_indexed = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM knowledge_vec_map`)
        .get() as { n: number }
    ).n;
  } catch {
    vec_indexed = 0;
  }

  return {
    sessions_total: sessionsTotal,
    sessions_by_status,
    failure_rate: Math.round(failure_rate * 1000) / 1000,
    avg_steps: Math.round(avg_steps * 100) / 100,
    knowledge_total,
    knowledge_pinned,
    audit_total,
    reviews_by_decision,
    vec_ready: isVecReady(),
    vec_indexed,
  };
}
