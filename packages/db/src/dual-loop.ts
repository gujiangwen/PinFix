import type Database from "better-sqlite3";
import type { PlanIR, ReviewIR } from "@sightloop/shared";

export function setSessionPlan(
  db: Database.Database,
  sessionId: string,
  plan: PlanIR | null,
  innerRefineCount?: number,
): void {
  if (innerRefineCount !== undefined) {
    db.prepare(
      `UPDATE sessions SET plan_json = ?, inner_refine_count = ?, dual_loop_enabled = 1, updated_at = ? WHERE id = ?`,
    ).run(
      plan ? JSON.stringify(plan) : null,
      innerRefineCount,
      Date.now(),
      sessionId,
    );
  } else {
    db.prepare(
      `UPDATE sessions SET plan_json = ?, dual_loop_enabled = 1, updated_at = ? WHERE id = ?`,
    ).run(plan ? JSON.stringify(plan) : null, Date.now(), sessionId);
  }
}

export function setSessionAgentReview(
  db: Database.Database,
  sessionId: string,
  review: ReviewIR | null,
): void {
  db.prepare(
    `UPDATE sessions SET agent_review_json = ?, updated_at = ? WHERE id = ?`,
  ).run(review ? JSON.stringify(review) : null, Date.now(), sessionId);
}

export function getSessionPlan(
  db: Database.Database,
  sessionId: string,
): PlanIR | null {
  const row = db
    .prepare(`SELECT plan_json FROM sessions WHERE id = ?`)
    .get(sessionId) as { plan_json: string | null } | undefined;
  if (!row?.plan_json) return null;
  try {
    return JSON.parse(row.plan_json) as PlanIR;
  } catch {
    return null;
  }
}

export function getSessionAgentReview(
  db: Database.Database,
  sessionId: string,
): ReviewIR | null {
  const row = db
    .prepare(`SELECT agent_review_json FROM sessions WHERE id = ?`)
    .get(sessionId) as { agent_review_json: string | null } | undefined;
  if (!row?.agent_review_json) return null;
  try {
    return JSON.parse(row.agent_review_json) as ReviewIR;
  } catch {
    return null;
  }
}
