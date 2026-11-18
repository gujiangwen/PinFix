import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import {
  EMBED_DIM,
  EMBED_MODEL_ID,
  embedKnowledgeCard,
  embedRetrieveQuery,
} from "./embed.js";
import type { Knowledge, KnowledgeKind } from "@sightloop/shared";

export type VecHit = {
  knowledge_id: string;
  distance: number;
  score: number;
};

let vecReady = false;

type KnowledgeRow = {
  id: string;
  project_id: string;
  session_id: string | null;
  kind: KnowledgeKind;
  title: string;
  body_md: string;
  embedding_ref: string | null;
  tags: string | null;
  stack: string | null;
  pinned: number | null;
  archived: number | null;
  last_used_at: number | null;
  last_used_session_id: string | null;
  created_at: number;
  updated_at: number | null;
};

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // ignore
  }
  return [];
}

function loadCard(db: Database.Database, id: string): Knowledge | undefined {
  const row = db.prepare("SELECT * FROM knowledge WHERE id = ?").get(id) as
    | KnowledgeRow
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    project_id: row.project_id,
    session_id: row.session_id,
    kind: row.kind,
    title: row.title,
    body_md: row.body_md,
    embedding_ref: row.embedding_ref,
    tags: parseTags(row.tags),
    stack: row.stack ?? null,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
    last_used_at: row.last_used_at ?? null,
    last_used_session_id: row.last_used_session_id ?? null,
  };
}

export function loadSqliteVec(db: Database.Database): void {
  try {
    sqliteVec.load(db);
    vecReady = true;
  } catch (err) {
    console.warn(
      `[sightloop/db] sqlite-vec load failed — falling back to text retrieve: ${
        (err as Error).message
      }`,
    );
    vecReady = false;
  }
}

export function isVecReady(): boolean {
  return vecReady;
}

/**
 * Create vec0 virtual table + rowid map. Safe to call after every open.
 * Markdown `knowledge` rows remain the source of truth.
 */
export function ensureVectorSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_vec_map (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_id TEXT NOT NULL UNIQUE,
      model TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  if (!vecReady) return;

  const exists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vec'`,
    )
    .get() as { name?: string } | undefined;

  if (!exists) {
    db.exec(
      `CREATE VIRTUAL TABLE knowledge_vec USING vec0(
        embedding float[${EMBED_DIM}]
      )`,
    );
  }
}

export function upsertKnowledgeEmbedding(
  db: Database.Database,
  knowledgeId: string,
): void {
  if (!vecReady) return;
  const row = loadCard(db, knowledgeId);
  if (!row || row.archived) {
    deleteKnowledgeEmbedding(db, knowledgeId);
    return;
  }

  const embedding = embedKnowledgeCard({
    title: row.title,
    body_md: row.body_md,
    tags: row.tags,
    stack: row.stack,
    kind: row.kind,
  });

  const map = db
    .prepare(`SELECT rowid FROM knowledge_vec_map WHERE knowledge_id = ?`)
    .get(knowledgeId) as { rowid: number } | undefined;

  const now = Date.now();
  let rowid: number;
  if (map) {
    rowid = map.rowid;
    db.prepare(
      `UPDATE knowledge_vec_map SET model = ?, updated_at = ? WHERE rowid = ?`,
    ).run(EMBED_MODEL_ID, now, rowid);
    db.prepare(`DELETE FROM knowledge_vec WHERE rowid = ?`).run(BigInt(rowid));
  } else {
    const info = db
      .prepare(
        `INSERT INTO knowledge_vec_map (knowledge_id, model, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(knowledgeId, EMBED_MODEL_ID, now);
    rowid = Number(info.lastInsertRowid);
  }

  db.prepare(
    `INSERT INTO knowledge_vec(rowid, embedding) VALUES (?, ?)`,
  ).run(BigInt(rowid), embedding);

  db.prepare(`UPDATE knowledge SET embedding_ref = ? WHERE id = ?`).run(
    `sqlite-vec:${EMBED_MODEL_ID}`,
    knowledgeId,
  );
}

export function deleteKnowledgeEmbedding(
  db: Database.Database,
  knowledgeId: string,
): void {
  const map = db
    .prepare(`SELECT rowid FROM knowledge_vec_map WHERE knowledge_id = ?`)
    .get(knowledgeId) as { rowid: number } | undefined;
  if (!map) return;
  if (vecReady) {
    try {
      db.prepare(`DELETE FROM knowledge_vec WHERE rowid = ?`).run(
        BigInt(map.rowid),
      );
    } catch {
      // ignore if vec table missing
    }
  }
  db.prepare(`DELETE FROM knowledge_vec_map WHERE knowledge_id = ?`).run(
    knowledgeId,
  );
}

export function searchKnowledgeVec(
  db: Database.Database,
  hints: {
    selector?: string | null;
    note?: string | null;
    componentNames?: string[];
    stack?: string | null;
  },
  limit = 8,
): VecHit[] {
  if (!vecReady) return [];

  const query = embedRetrieveQuery(hints);
  // vec0 KNN requires a literal LIMIT or `k = N` (bound LIMIT params are rejected).
  const k = Math.max(1, Math.min(Math.floor(Math.max(limit * 3, 12)), 64));
  const rows = db
    .prepare(
      `
      SELECT
        m.knowledge_id AS knowledge_id,
        v.distance AS distance
      FROM knowledge_vec v
      JOIN knowledge_vec_map m ON m.rowid = v.rowid
      WHERE v.embedding MATCH ?
        AND k = ${k}
      ORDER BY v.distance
      `,
    )
    .all(query) as Array<{
    knowledge_id: string;
    distance: number;
  }>;

  const hits: VecHit[] = [];
  for (const r of rows) {
    const k = loadCard(db, r.knowledge_id);
    if (!k || k.archived) continue;
    if (hints.stack && k.stack && k.stack !== hints.stack) continue;
    // Smaller distance → higher score.
    const score = Math.max(0, 12 - r.distance * 12);
    hits.push({
      knowledge_id: r.knowledge_id,
      distance: r.distance,
      score,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Re-index all non-archived knowledge cards (idempotent). */
export function reindexAllKnowledge(db: Database.Database): number {
  if (!vecReady) return 0;
  const ids = db
    .prepare(
      `SELECT id FROM knowledge WHERE archived IS NULL OR archived = 0`,
    )
    .all() as Array<{ id: string }>;
  for (const { id } of ids) upsertKnowledgeEmbedding(db, id);
  return ids.length;
}
