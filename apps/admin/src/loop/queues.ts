import type { Session, SessionStatus } from "@sightloop/shared";
import { focusNode, NODE_IDS, type LoopModel, type NodeId } from "./loop-model";

/**
 * Home queues. The Daemon does not schedule three roles at once: one session
 * walks Planner → Implementer → Reviewer, and a project repo runs one active
 * session. A task is "running" only when its session status says the loop is
 * inside that stage. The head of a queue is not marked running just because
 * it is first.
 *
 * awaiting_review stays on Reviewer here. The home's 人工审核 switch is only
 * a view over that status; it is not another role the daemon runs.
 */

export const ROLES = ["planner", "implementer", "reviewer"] as const;
export type RoleId = (typeof ROLES)[number];

const TERMINAL: ReadonlySet<SessionStatus> = new Set([
  "accepted",
  "reverted",
  "failed",
  "distilling",
]);

export type TaskPlacement = {
  session: Session;
  role: RoleId;
  /** True only while this session's loop is executing inside `role`. */
  executing: boolean;
};

export type RoleQueue = {
  role: RoleId;
  /** Oldest first. The first item is the FIFO head. */
  tasks: TaskPlacement[];
  /** Running when at least one task in this role is actually executing. */
  state: "running" | "idle";
  runningCount: number;
  waitingCount: number;
};

export function roleOfNode(id: NodeId): RoleId {
  if (id === "retrieve" || id === "plan") return "planner";
  if (id === "implement" || id === "verify") return "implementer";
  // Gate, agent review, and the human pass/reject are one Reviewer stage.
  return "reviewer";
}

/** Current role of a session whose status is `acting` (steps decide the stage). */
export function roleFromModel(model: LoopModel): RoleId {
  const round = model.rounds[model.rounds.length - 1];
  if (!round) return "implementer";
  const active = NODE_IDS.find((id) => round.nodes[id].state === "active");
  return roleOfNode(active ?? focusNode(round));
}

/**
 * Place one session into a role queue, or return null when it is finished
 * and no longer waiting on a role.
 */
export function placeSession(
  session: Session,
  actingRole: RoleId | null,
): TaskPlacement | null {
  switch (session.status) {
    case "idle":
    case "refined":
      return { session, role: "planner", executing: false };
    case "retrieving":
      return { session, role: "planner", executing: true };
    case "acting":
      return {
        session,
        role: actingRole ?? "implementer",
        executing: true,
      };
    case "awaiting_review":
      return { session, role: "reviewer", executing: false };
    default:
      return TERMINAL.has(session.status) ? null : null;
  }
}

export function buildQueues(tasks: TaskPlacement[]): RoleQueue[] {
  return ROLES.map((role) => {
    const inRole = tasks
      .filter((task) => task.role === role)
      .sort(
        (a, b) =>
          a.session.created_at - b.session.created_at ||
          a.session.id.localeCompare(b.session.id),
      );
    const runningCount = inRole.filter((task) => task.executing).length;
    return {
      role,
      tasks: inRole,
      state: runningCount > 0 ? "running" : "idle",
      runningCount,
      waitingCount: inRole.length - runningCount,
    };
  });
}
