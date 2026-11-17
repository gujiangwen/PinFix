import type Database from "better-sqlite3";
import {
  type Knowledge,
  type KnowledgeKind,
} from "@sightloop/shared";
import { ulid } from "ulid";

type KnowledgeRow = {
  id: string;
  project_id: string;
  session_id: string | null;
  kind: KnowledgeKind;
  title: string;
  body_md: string;
  embedding_ref: string | null;
  created_at: number;
};

function rowToKnowledge(row: KnowledgeRow): Knowledge {
  return {
    id: row.id,
    project_id: row.project_id,
    session_id: row.session_id,
    kind: row.kind,
    title: row.title,
    body_md: row.body_md,
    embedding_ref: row.embedding_ref,
    created_at: row.created_at,
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
  },
): Knowledge {
  const item: Knowledge = {
    id: ulid(),
    project_id: input.project_id,
    session_id: input.session_id ?? null,
    kind: input.kind,
    title: input.title,
    body_md: input.body_md,
    embedding_ref: input.embedding_ref ?? null,
    created_at: Date.now(),
  };

  db.prepare(
    `INSERT INTO knowledge (
      id, project_id, session_id, kind, title, body_md, embedding_ref, created_at
    ) VALUES (
      @id, @project_id, @session_id, @kind, @title, @body_md, @embedding_ref, @created_at
    )`,
  ).run(item);

  return item;
}

export function listKnowledge(
  db: Database.Database,
  projectId?: string,
  limit = 50,
): Knowledge[] {
  const rows = (
    projectId
      ? db
          .prepare(
            `SELECT * FROM knowledge WHERE project_id = ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(projectId, limit)
      : db
          .prepare(
            `SELECT * FROM knowledge ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit)
  ) as KnowledgeRow[];
  return rows.map(rowToKnowledge);
}
