import type Database from "better-sqlite3";
import {
  type Review,
  type ReviewDecision,
} from "@sightloop/shared";
import { ulid } from "ulid";

type ReviewRow = {
  id: string;
  session_id: string;
  decision: ReviewDecision;
  note: string | null;
  created_at: number;
};

function rowToReview(row: ReviewRow): Review {
  return {
    id: row.id,
    session_id: row.session_id,
    decision: row.decision,
    note: row.note,
    created_at: row.created_at,
  };
}

export function insertReview(
  db: Database.Database,
  input: {
    session_id: string;
    decision: ReviewDecision;
    note?: string | null;
  },
): Review {
  const review: Review = {
    id: ulid(),
    session_id: input.session_id,
    decision: input.decision,
    note: input.note ?? null,
    created_at: Date.now(),
  };

  db.prepare(
    `INSERT INTO reviews (id, session_id, decision, note, created_at)
     VALUES (@id, @session_id, @decision, @note, @created_at)`,
  ).run(review);

  return review;
}

export function listReviews(
  db: Database.Database,
  sessionId: string,
): Review[] {
  const rows = db
    .prepare(
      `SELECT * FROM reviews WHERE session_id = ? ORDER BY created_at ASC`,
    )
    .all(sessionId) as ReviewRow[];
  return rows.map(rowToReview);
}
