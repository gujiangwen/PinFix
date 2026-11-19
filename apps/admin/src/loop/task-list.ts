import type { Session } from "@sightloop/shared";
import type { TaskPlacement } from "./queues";

/**
 * Home switches. Human review is the existing awaiting_review step.
 * It is not a fourth agent and it does not schedule anything.
 */
export const QUEUE_SWITCHES = ["planner", "implementer", "reviewer", "human"] as const;
export type QueueSwitch = (typeof QUEUE_SWITCHES)[number];

/**
 * Which switch lists this session. Finished sessions return null.
 * awaiting_review is the human switch. placeSession still files that
 * status under Reviewer so the three-step flow stays one stage.
 */
export function queueOf(
  session: Pick<Session, "status">,
  placement: TaskPlacement | null,
): QueueSwitch | null {
  if (session.status === "awaiting_review") return "human";
  if (!placement) return null;
  return placement.role;
}

/** Fields the keyword box searches. Project name is filled in by the caller. */
export function taskHaystack(session: Session, projectName: string | null): string {
  return [session.annotation?.note, session.page_url, projectName, session.id]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join("\n")
    .toLowerCase();
}

export function matchesKeyword(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.includes(needle);
}

/** Oldest first. Order is display only; it does not choose who runs. */
export function byCreated<T extends { session: Pick<Session, "created_at" | "id"> }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.session.created_at - b.session.created_at ||
      a.session.id.localeCompare(b.session.id),
  );
}

/**
 * Session to show before the user clicks. Only an executing row counts.
 * When several are executing, the oldest is the default view. That does
 * not mark it as the scheduled head, and a waiting row is never chosen.
 */
export function defaultRunningId(
  rows: readonly { session: Pick<Session, "id" | "created_at">; executing: boolean }[],
): string | null {
  const running = byCreated(rows.filter((row) => row.executing));
  return running[0]?.session.id ?? null;
}
