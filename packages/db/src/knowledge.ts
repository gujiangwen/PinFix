import type Database from "better-sqlite3";
import {
  type Knowledge,
  type KnowledgeKind,
  type CreateKnowledgeInput,
  type UpdateKnowledgeInput,
  type KnowledgeFilter,
} from "@sightloop/shared";
import { ulid } from "ulid";
import {
  deleteKnowledgeEmbedding,
  searchKnowledgeVec,
  upsertKnowledgeEmbedding,
} from "./vectors.js";

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
    // fall through
  }
  return [];
}

function rowToKnowledge(row: KnowledgeRow): Knowledge {
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
  };
}

export function insertKnowledge(
  db: Database.Database,
  input: {
    project_id: string;
    session_id?: string | null;
    kind: KnowledgeKind;
    title: string;
    body_md: string;
    embedding_ref?: string | null;
    tags?: string[];
    stack?: string | null;
    pinned?: boolean;
    archived?: boolean;
  },
): Knowledge {
  const now = Date.now();
  const item: Knowledge = {
    id: ulid(),
    project_id: input.project_id,
    session_id: input.session_id ?? null,
    kind: input.kind,
    title: input.title,
    body_md: input.body_md,
    embedding_ref: input.embedding_ref ?? null,
    tags: input.tags ?? [],
    stack: input.stack ?? null,
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO knowledge (
      id, project_id, session_id, kind, title, body_md, embedding_ref,
      tags, stack, pinned, archived, created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @kind, @title, @body_md, @embedding_ref,
      @tags, @stack, @pinned, @archived, @created_at, @updated_at
    )`,
  ).run({
    ...item,
    tags: JSON.stringify(item.tags),
    pinned: item.pinned ? 1 : 0,
    archived: item.archived ? 1 : 0,
  });

  // Derived sqlite-vec index (Markdown row remains source of truth).
  upsertKnowledgeEmbedding(db, item.id);
  return getKnowledge(db, item.id) ?? item;
}

export function createKnowledgeFromInput(
  db: Database.Database,
  input: CreateKnowledgeInput,
): Knowledge {
  return insertKnowledge(db, {
    project_id: input.project_id,
    session_id: input.session_id,
    kind: input.kind,
    title: input.title,
    body_md: input.body_md,
    tags: input.tags,
    stack: input.stack,
    pinned: input.pinned,
  });
}

export function getKnowledge(
  db: Database.Database,
  id: string,
): Knowledge | undefined {
  const row = db.prepare("SELECT * FROM knowledge WHERE id = ?").get(id) as
    | KnowledgeRow
    | undefined;
  return row ? rowToKnowledge(row) : undefined;
}

export function listKnowledge(
  db: Database.Database,
  projectId?: string,
  limit = 50,
): Knowledge[] {
  return queryKnowledge(db, {
    project_id: projectId,
    include_archived: false,
    limit,
  });
}

export function queryKnowledge(
  db: Database.Database,
  filter: KnowledgeFilter = {},
): Knowledge[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.project_id) {
    where.push("project_id = ?");
    params.push(filter.project_id);
  }
  if (filter.stack) {
    where.push("stack = ?");
    params.push(filter.stack);
  }
  if (filter.kind) {
    where.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.pinned === true) {
    where.push("pinned = 1");
  }
  if (!filter.include_archived) {
    where.push("(archived IS NULL OR archived = 0)");
  }
  if (filter.tag) {
    where.push("tags LIKE ?");
    params.push(`%"${filter.tag}"%`);
  }
  if (filter.q) {
    where.push("(title LIKE ? OR body_md LIKE ? OR tags LIKE ?)");
    const like = `%${filter.q}%`;
    params.push(like, like, like);
  }

  const limit = filter.limit ?? 50;
  const sql = `SELECT * FROM knowledge
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY pinned DESC, created_at DESC
    LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as KnowledgeRow[];
  return rows.map(rowToKnowledge);
}

/**
 * Rank project knowledge for Retrieve-before-act.
 * Primary: sqlite-vec similarity. Secondary: pinned + text overlap.
 * Markdown cards remain the source of truth; vectors are a derived index.
 */
export function matchKnowledgeForRetrieve(
  db: Database.Database,
  projectId: string,
  hints: {
    selector?: string | null;
    note?: string | null;
    componentNames?: string[];
    stack?: string | null;
  },
  limit = 8,
): Array<Knowledge & { score: number; distance?: number; retrieve?: string }> {
  const byId = new Map<
    string,
    Knowledge & { score: number; distance?: number; retrieve?: string }
  >();

  const vecHits = searchKnowledgeVec(db, hints, limit * 2);
  for (const hit of vecHits) {
    const k = getKnowledge(db, hit.knowledge_id);
    if (!k || k.project_id !== projectId || k.archived) continue;
    byId.set(k.id, {
      ...k,
      score: hit.score + (k.pinned ? 2 : 0),
      distance: hit.distance,
      retrieve: "sqlite-vec",
    });
  }

  const candidates = queryKnowledge(db, {
    project_id: projectId,
    include_archived: false,
    stack: hints.stack ?? undefined,
    limit: 80,
  });

  const needles = [
    hints.selector,
    hints.note,
    ...(hints.componentNames ?? []),
  ]
    .filter((x): x is string => Boolean(x && x.trim()))
    .map((s) => s.toLowerCase());

  for (const k of candidates) {
    let textScore = k.pinned ? 5 : 0;
    const hay = `${k.title}\n${k.body_md}\n${k.tags.join(" ")}`.toLowerCase();
    for (const n of needles) {
      if (n.length >= 2 && hay.includes(n)) textScore += 3;
      else {
        const tokens = n.split(/[^a-z0-9_-]+/).filter((t) => t.length >= 3);
        for (const t of tokens) {
          if (hay.includes(t)) textScore += 1;
        }
      }
    }
    if (hints.stack && k.stack === hints.stack) textScore += 2;

    const existing = byId.get(k.id);
    if (existing) {
      existing.score += textScore * 0.5;
      existing.retrieve = existing.distance != null ? "sqlite-vec+text" : "text";
    } else if (textScore > 0 || needles.length === 0) {
      byId.set(k.id, {
        ...k,
        score: textScore,
        retrieve: "text",
      });
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.score - a.score || b.created_at - a.created_at)
    .slice(0, limit);
}

export function updateKnowledge(
  db: Database.Database,
  id: string,
  patch: UpdateKnowledgeInput,
): Knowledge | undefined {
  const existing = getKnowledge(db, id);
  if (!existing) return undefined;

  const next: Knowledge = {
    ...existing,
    title: patch.title ?? existing.title,
    body_md: patch.body_md ?? existing.body_md,
    kind: patch.kind ?? existing.kind,
    tags: patch.tags ?? existing.tags,
    stack: patch.stack !== undefined ? patch.stack : existing.stack ?? null,
    pinned: patch.pinned ?? existing.pinned,
    archived: patch.archived ?? existing.archived,
    updated_at: Date.now(),
  };

  db.prepare(
    `UPDATE knowledge SET
      title = @title,
      body_md = @body_md,
      kind = @kind,
      tags = @tags,
      stack = @stack,
      pinned = @pinned,
      archived = @archived,
      updated_at = @updated_at
    WHERE id = @id`,
  ).run({
    id,
    title: next.title,
    body_md: next.body_md,
    kind: next.kind,
    tags: JSON.stringify(next.tags),
    stack: next.stack,
    pinned: next.pinned ? 1 : 0,
    archived: next.archived ? 1 : 0,
    updated_at: next.updated_at,
  });

  upsertKnowledgeEmbedding(db, id);
  return getKnowledge(db, id);
}

export function deleteKnowledge(db: Database.Database, id: string): boolean {
  deleteKnowledgeEmbedding(db, id);
  const result = db.prepare("DELETE FROM knowledge WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listKnowledgeByIds(
  db: Database.Database,
  ids: string[],
): Knowledge[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM knowledge WHERE id IN (${placeholders})`)
    .all(...ids) as KnowledgeRow[];
  const map = new Map(rows.map((r) => [r.id, rowToKnowledge(r)]));
  return ids.map((id) => map.get(id)).filter((k): k is Knowledge => Boolean(k));
}
