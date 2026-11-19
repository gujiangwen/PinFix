import type { Session, SessionStatus } from "@sightloop/shared";
import type { RoleId, TaskPlacement } from "./queues";

/** Home status chips. Each chip is a slice of the daemon's session statuses. */
export const STATUS_FILTERS = ["open", "queued", "running", "review", "done"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_STATUSES: Record<StatusFilter, ReadonlySet<SessionStatus>> = {
  open: new Set(["idle", "retrieving", "acting", "awaiting_review", "refined"]),
  queued: new Set(["idle", "refined"]),
  running: new Set(["retrieving", "acting"]),
  review: new Set(["awaiting_review"]),
  done: new Set(["accepted", "reverted", "failed", "distilling"]),
};

export function sessionMatchesFilter(status: SessionStatus, filter: StatusFilter): boolean {
  return FILTER_STATUSES[filter].has(status);
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
 * Tasks this role is actually executing. Waiting tasks, including the FIFO
 * head, are not included. Every executing task is returned.
 */
export function runningInRole(
  tasks: readonly TaskPlacement[],
  role: RoleId,
): TaskPlacement[] {
  return byCreated(tasks.filter((task) => task.role === role && task.executing));
}
