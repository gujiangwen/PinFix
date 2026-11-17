import type Database from "better-sqlite3";
import type { SourceLocationHint } from "@sightloop/shared";
import { ulid } from "ulid";

type HintRow = {
  id: string;
  project_id: string;
  selector: string | null;
  fingerprint: string | null;
  file_path: string;
  line: number | null;
  confidence: number;
  source: "human" | "source_map" | "heuristic" | "distill";
  hit_count: number;
  updated_at: number;
  created_at: number;
};

function rowToHint(row: HintRow): SourceLocationHint {
  return {
    id: row.id,
    project_id: row.project_id,
    selector: row.selector,
    fingerprint: row.fingerprint,
    file_path: row.file_path,
    line: row.line,
    confidence: row.confidence,
    source: row.source,
    hit_count: row.hit_count,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

export function listLocationHints(
  db: Database.Database,
  projectId: string,
): SourceLocationHint[] {
  const rows = db
    .prepare(
      `SELECT * FROM source_location_hints
       WHERE project_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(projectId) as HintRow[];
  return rows.map(rowToHint);
}

export function findLocationHint(
  db: Database.Database,
  projectId: string,
  opts: { selector?: string | null; fingerprint?: string | null },
): SourceLocationHint | undefined {
  if (opts.selector) {
    const bySel = db
      .prepare(
        `SELECT * FROM source_location_hints
         WHERE project_id = ? AND selector = ?
         ORDER BY confidence DESC, hit_count DESC, updated_at DESC
         LIMIT 1`,
      )
      .get(projectId, opts.selector) as HintRow | undefined;
    if (bySel) return rowToHint(bySel);
  }
  if (opts.fingerprint) {
    const byFp = db
      .prepare(
        `SELECT * FROM source_location_hints
         WHERE project_id = ? AND fingerprint = ?
         ORDER BY confidence DESC, hit_count DESC, updated_at DESC
         LIMIT 1`,
      )
      .get(projectId, opts.fingerprint) as HintRow | undefined;
    if (byFp) return rowToHint(byFp);
  }
  return undefined;
}

export function upsertLocationHint(
  db: Database.Database,
  input: {
    project_id: string;
    selector?: string | null;
    fingerprint?: string | null;
    file_path: string;
    line?: number | null;
    confidence?: number;
    source: "human" | "source_map" | "heuristic" | "distill";
  },
): SourceLocationHint {
  const now = Date.now();
  const existing = findLocationHint(db, input.project_id, {
    selector: input.selector,
    fingerprint: input.fingerprint,
  });

  if (
    existing &&
    existing.selector === (input.selector ?? null) &&
    existing.file_path === input.file_path
  ) {
    db.prepare(
      `UPDATE source_location_hints SET
         line = ?,
         confidence = ?,
         source = ?,
         hit_count = hit_count + 1,
         updated_at = ?
       WHERE id = ?`,
    ).run(
      input.line ?? existing.line,
      input.confidence ?? existing.confidence,
      input.source,
      now,
      existing.id,
    );
    return getLocationHint(db, existing.id)!;
  }

  // Same selector/fingerprint but different file → overwrite (human correct).
  if (existing && (input.selector || input.fingerprint)) {
    db.prepare(
      `UPDATE source_location_hints SET
         file_path = ?,
         line = ?,
         confidence = ?,
         source = ?,
         hit_count = hit_count + 1,
         updated_at = ?,
         selector = COALESCE(?, selector),
         fingerprint = COALESCE(?, fingerprint)
       WHERE id = ?`,
    ).run(
      input.file_path,
      input.line ?? null,
      input.confidence ?? 1,
      input.source,
      now,
      input.selector ?? null,
      input.fingerprint ?? null,
      existing.id,
    );
    return getLocationHint(db, existing.id)!;
  }

  const id = ulid();
  db.prepare(
    `INSERT INTO source_location_hints (
      id, project_id, selector, fingerprint, file_path, line,
      confidence, source, hit_count, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.selector ?? null,
    input.fingerprint ?? null,
    input.file_path,
    input.line ?? null,
    input.confidence ?? 1,
    input.source,
    now,
    now,
  );
  return getLocationHint(db, id)!;
}

export function bumpLocationHintHit(
  db: Database.Database,
  id: string,
): void {
  db.prepare(
    `UPDATE source_location_hints
     SET hit_count = hit_count + 1, updated_at = ?
     WHERE id = ?`,
  ).run(Date.now(), id);
}

export function getLocationHint(
  db: Database.Database,
  id: string,
): SourceLocationHint | undefined {
  const row = db
    .prepare(`SELECT * FROM source_location_hints WHERE id = ?`)
    .get(id) as HintRow | undefined;
  return row ? rowToHint(row) : undefined;
}
