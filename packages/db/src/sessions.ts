import type Database from "better-sqlite3";
import {
  type Annotation,
  type CreateSessionInput,
  type Session,
  type SessionStatus,
} from "@sightloop/shared";
import { ulid } from "ulid";

type SessionRow = {
  id: string;
  project_id: string;
  page_url: string;
  status: SessionStatus;
  sniff_json: string | null;
  annotation_ref: string | null;
  max_steps: number;
  step_count: number;
  git_base_sha: string | null;
  temp_commit_sha: string | null;
  created_at: number;
  updated_at: number;
};

function parseSniff(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    project_id: row.project_id,
    page_url: row.page_url,
    status: row.status,
    sniff: parseSniff(row.sniff_json),
    annotation_ref: row.annotation_ref,
    max_steps: row.max_steps,
    step_count: row.step_count,
    git_base_sha: row.git_base_sha,
    temp_commit_sha: row.temp_commit_sha,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createSession(
  db: Database.Database,
  input: CreateSessionInput,
): Session {
  const now = Date.now();
  const session: Session = {
    id: ulid(),
    project_id: input.project_id,
    page_url: input.page_url,
    status: "idle",
    sniff: input.sniff,
    annotation_ref: input.annotation_ref ?? null,
    annotation: input.annotation ?? null,
    max_steps: input.max_steps ?? 5,
    step_count: 0,
    git_base_sha: null,
    temp_commit_sha: null,
    created_at: now,
    updated_at: now,
  };

  // Persist annotation note into annotation_ref stem when provided without ref.
  let annotationRef = session.annotation_ref;
  if (!annotationRef && input.annotation?.note) {
    annotationRef = `inline:${session.id}`;
  }

  db.prepare(
    `INSERT INTO sessions (
      id, project_id, page_url, status, sniff_json, annotation_ref,
      max_steps, step_count, git_base_sha, temp_commit_sha, created_at, updated_at
    ) VALUES (
      @id, @project_id, @page_url, @status, @sniff_json, @annotation_ref,
      @max_steps, @step_count, @git_base_sha, @temp_commit_sha, @created_at, @updated_at
    )`,
  ).run({
    id: session.id,
    project_id: session.project_id,
    page_url: session.page_url,
    status: session.status,
    sniff_json: JSON.stringify({
      sniff: input.sniff,
      ...(input.annotation ? { annotation: input.annotation } : {}),
    }),
    annotation_ref: annotationRef,
    max_steps: session.max_steps,
    step_count: session.step_count,
    git_base_sha: null,
    temp_commit_sha: null,
    created_at: session.created_at,
    updated_at: session.updated_at,
  });

  return {
    ...session,
    annotation_ref: annotationRef,
  };
}

export function getSession(
  db: Database.Database,
  id: string,
): Session | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
  if (!row) return undefined;
  const session = rowToSession(row);
  // Rehydrate annotation from sniff_json envelope when present.
  const envelope = parseSniff(row.sniff_json) as {
    sniff?: unknown;
    annotation?: Annotation;
  } | null;
  if (envelope && typeof envelope === "object" && "sniff" in envelope) {
    session.sniff = envelope.sniff ?? null;
    if (envelope.annotation) session.annotation = envelope.annotation;
  }
  return session;
}

export function listSessions(
  db: Database.Database,
  projectId?: string,
  limit = 50,
): Session[] {
  const rows = (
    projectId
      ? db
          .prepare(
            `SELECT * FROM sessions WHERE project_id = ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(projectId, limit)
      : db
          .prepare(
            `SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit)
  ) as SessionRow[];
  return rows.map((row) => {
    const session = rowToSession(row);
    const envelope = parseSniff(row.sniff_json) as {
      sniff?: unknown;
      annotation?: Annotation;
    } | null;
    if (envelope && typeof envelope === "object" && "sniff" in envelope) {
      session.sniff = envelope.sniff ?? null;
      if (envelope.annotation) session.annotation = envelope.annotation;
    }
    return session;
  });
}

export function updateSessionStatus(
  db: Database.Database,
  id: string,
  status: SessionStatus,
  stepCount?: number,
): Session | undefined {
  const existing = getSession(db, id);
  if (!existing) return undefined;
  const now = Date.now();
  const nextStep = stepCount ?? existing.step_count;
  db.prepare(
    `UPDATE sessions SET status = ?, step_count = ?, updated_at = ? WHERE id = ?`,
  ).run(status, nextStep, now, id);
  return getSession(db, id);
}
