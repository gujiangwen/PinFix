import type {
  AcceptanceRunSummary,
  AgentStep,
  Review,
  Session,
} from "@sightloop/shared";

/**
 * The Daemon stores a flat list of agent steps. This module folds that list
 * into the shape a person watches: rounds of the loop, each with the same
 * seven nodes, each node in one state.
 */

export const NODE_IDS = [
  "retrieve",
  "plan",
  "implement",
  "verify",
  "gate",
  "review",
  "human",
] as const;
export type NodeId = (typeof NODE_IDS)[number];

export type NodeState =
  /** Not reached yet in this round. */
  | "pending"
  /** Running now, or (for `human`) waiting for a decision. */
  | "active"
  | "done"
  /** Finished, but sent the loop around again (reviewer or human asked for a refine). */
  | "warn"
  | "failed"
  /** Not part of this round: skipped, or the session runs without the dual loop. */
  | "off";

export type LoopNode = {
  id: NodeId;
  state: NodeState;
  steps: AgentStep[];
  durationMs: number | null;
};

export type LoopRound = {
  /** 1-based. */
  number: number;
  nodes: Record<NodeId, LoopNode>;
  /** The human decision that closed this round, if one was made. */
  decision: Review | null;
};

export type LoopModel = {
  /** Whether the session uses Planner/Reviewer; null until a step reveals it. */
  dual: boolean | null;
  rounds: LoopRound[];
};

export type LoopInput = {
  session: Pick<Session, "status">;
  steps: AgentStep[];
  reviews: Review[];
  /** Latest acceptance-gate run from the read model. */
  gateRun?: Pick<AcceptanceRunSummary, "status"> | null;
  /** Node the Daemon last announced over the WebSocket, when known. */
  liveNode?: NodeId | null;
  /** The Daemon's current dual-loop setting, used until the steps show which loop ran. */
  dualHint?: boolean | null;
};

const ORDER: Record<NodeId, number> = Object.fromEntries(
  NODE_IDS.map((id, i) => [id, i]),
) as Record<NodeId, number>;

const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  "retrieving",
  "acting",
  "refined",
]);

/** Nodes that only exist when the Planner/Reviewer dual loop is on. */
const DUAL_ONLY: ReadonlySet<NodeId> = new Set(["plan", "review"]);

export function nodeOfStep(step: Pick<AgentStep, "phase" | "tool_name">): NodeId {
  if (step.tool_name === "acceptance_gate") return "gate";
  // The single-loop step budget guard is recorded under the plan phase.
  if (step.tool_name === "max_steps_guard") return "implement";
  switch (step.phase) {
    case "retrieve":
      return "retrieve";
    case "plan":
      return "plan";
    case "act":
      return "implement";
    case "verify":
      return "verify";
    case "review":
      return "review";
  }
}

/** `session.dual_loop` node names → track nodes; `finalize` has no node of its own. */
export function nodeOfDualLoopEvent(node: string): NodeId | null {
  switch (node) {
    case "retrieve":
      return "retrieve";
    case "planner":
      return "plan";
    case "implementer":
      return "implement";
    case "verify_shell":
      return "verify";
    case "acceptance_gate":
      return "gate";
    case "reviewer":
      return "review";
    default:
      return null;
  }
}

function usesDualLoop(input: LoopInput): boolean | null {
  // Only the dual-loop graph announces nodes over the WebSocket.
  if (input.liveNode) return true;
  const dualStep = input.steps.some((s) => {
    const tool = s.tool_name ?? "";
    return (
      s.phase === "review" ||
      tool === "verify_contract" ||
      tool.endsWith("_planner") ||
      tool.endsWith("_reviewer")
    );
  });
  if (dualStep) return true;
  // The dual loop always plans before it implements.
  if (input.steps.some((s) => s.phase === "act")) return false;
  return input.dualHint ?? null;
}

function field(output: unknown, key: string): unknown {
  return output && typeof output === "object"
    ? (output as Record<string, unknown>)[key]
    : undefined;
}

function gateRunState(status: string): NodeState {
  if (status === "passed") return "done";
  if (status === "failed" || status === "error") return "failed";
  if (status === "queued" || status === "running") return "active";
  // Cancelled: the run produced no result.
  return "off";
}

function stateFromSteps(id: NodeId, steps: AgentStep[]): NodeState {
  if (steps.some((s) => s.error)) return "failed";
  const last = steps[steps.length - 1]!;
  if (id === "verify" && field(last.output, "ok") === false) return "failed";
  if (id === "gate") {
    // Inside the graph the gate is skipped (disabled, or deferred until the
    // loop stops for review) and its report then carries no run status.
    const status = field(field(last.output, "report"), "status");
    return typeof status === "string" && status !== "skipped"
      ? gateRunState(status)
      : "off";
  }
  if (id === "review" && field(last.output, "verdict") === "refine") {
    return "warn";
  }
  return "done";
}

/** Why the graph skipped the gate, e.g. `disabled` or `deferred_to_post_act`. */
export function gateSkipReason(node: LoopNode): string | null {
  const last = node.steps[node.steps.length - 1];
  const reason = field(field(last?.output, "report"), "reason");
  return typeof reason === "string" ? reason : null;
}

function emptyRound(number: number): LoopRound {
  const node = (id: NodeId): LoopNode => ({
    id,
    state: "pending",
    steps: [],
    durationMs: null,
  });
  return {
    number,
    nodes: {
      retrieve: node("retrieve"),
      plan: node("plan"),
      implement: node("implement"),
      verify: node("verify"),
      gate: node("gate"),
      review: node("review"),
      human: node("human"),
    },
    decision: null,
  };
}

function splitIntoRounds(steps: AgentStep[]): LoopRound[] {
  const rounds: LoopRound[] = [];
  let current: LoopRound | null = null;
  let furthest = -1;
  for (const step of [...steps].sort((a, b) => a.idx - b.idx)) {
    const id = nodeOfStep(step);
    // The loop only moves forward within a round; stepping back to an earlier
    // node means it went around again.
    if (!current || ORDER[id] < furthest) {
      current = emptyRound(rounds.length + 1);
      rounds.push(current);
      furthest = -1;
    }
    furthest = Math.max(furthest, ORDER[id]);
    current.nodes[id].steps.push(step);
  }
  return rounds;
}

function roundStartedAt(round: LoopRound): number {
  let first = Infinity;
  for (const id of NODE_IDS) {
    for (const step of round.nodes[id].steps) {
      first = Math.min(first, step.created_at);
    }
  }
  return first;
}

function assignDecisions(rounds: LoopRound[], reviews: Review[]): void {
  for (const review of [...reviews].sort((a, b) => a.created_at - b.created_at)) {
    let owner: LoopRound | undefined;
    for (const round of rounds) {
      if (roundStartedAt(round) <= review.created_at) owner = round;
    }
    if (owner) owner.decision = review;
  }
}

function furthestReached(round: LoopRound): number {
  let reached = -1;
  for (const id of NODE_IDS) {
    if (round.nodes[id].steps.length > 0) reached = ORDER[id];
  }
  return reached;
}

/**
 * Steps are written when a node finishes, so while the loop runs the node in
 * progress is the first applicable one after the furthest node with steps.
 */
function inferRunningNode(
  round: LoopRound,
  dual: boolean | null,
  resumeAt: NodeId,
): NodeId | null {
  const reached = Math.max(furthestReached(round), ORDER[resumeAt] - 1);
  for (const id of NODE_IDS) {
    if (ORDER[id] <= reached || id === "human") continue;
    if (dual === false && (DUAL_ONLY.has(id) || id === "gate")) continue;
    return id;
  }
  return null;
}

export function buildLoopModel(input: LoopInput): LoopModel {
  const { session, steps, reviews } = input;
  const dual = usesDualLoop(input);
  const rounds = splitIntoRounds(steps);
  if (rounds.length === 0) rounds.push(emptyRound(1));
  assignDecisions(rounds, reviews);

  const running = RUNNING_STATUSES.has(session.status);

  // The loop can start a new round before that round has written any step.
  // Show it right away instead of lighting up a node in the finished round.
  const recorded = rounds[rounds.length - 1]!;
  const reviewSteps = recorded.nodes.review.steps;
  const reviewerVerdict = field(
    reviewSteps[reviewSteps.length - 1]?.output,
    "verdict",
  );
  let resumeAt: NodeId = "retrieve";
  if (recorded.decision?.decision === "refine") {
    // A human refine restarts the graph from retrieve.
    rounds.push(emptyRound(rounds.length + 1));
  } else if (running && !recorded.decision) {
    const wentBack =
      input.liveNode != null &&
      ORDER[input.liveNode] < furthestReached(recorded);
    if (wentBack || reviewerVerdict === "refine") {
      // A reviewer refine re-enters at the planner (or straight at the implementer).
      rounds.push(emptyRound(rounds.length + 1));
      resumeAt = "plan";
    }
  }

  rounds.forEach((round, i) => {
    const isLast = i === rounds.length - 1;
    const reached = furthestReached(round);

    for (const id of NODE_IDS) {
      if (id === "human") continue;
      const node = round.nodes[id];
      if (node.steps.length > 0) {
        node.state = stateFromSteps(id, node.steps);
        const timed = node.steps.filter((s) => s.duration_ms != null);
        // A skipped node did no work worth timing.
        node.durationMs =
          timed.length && node.state !== "off"
            ? timed.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0)
            : null;
      } else if (dual === false && DUAL_ONLY.has(id)) {
        node.state = "off";
      } else if (!isLast || ORDER[id] < reached) {
        // The round moved past this node without running it.
        node.state = "off";
      }
    }

    const human = round.nodes.human;
    if (round.decision) {
      human.state =
        round.decision.decision === "accept"
          ? "done"
          : round.decision.decision === "refine"
            ? "warn"
            : "failed";
    } else if (!isLast) {
      human.state = "off";
    }
  });

  const last = rounds[rounds.length - 1]!;

  // The acceptance gate also runs outside the graph (on awaiting_review, or
  // by hand), so the latest run is the truth for the current round.
  const gate = last.nodes.gate;
  const settled = !running && furthestReached(last) >= 0;
  if (input.gateRun && (gate.steps.length > 0 || settled)) {
    gate.state = gateRunState(input.gateRun.status);
  } else if (
    gateSkipReason(gate) === "deferred_to_post_act" &&
    (running || session.status === "awaiting_review")
  ) {
    // Its run starts once the loop stops for review.
    gate.state = "pending";
  } else if (dual === false && gate.steps.length === 0) {
    gate.state = "off";
  }

  if (session.status === "awaiting_review" && !last.decision) {
    last.nodes.human.state = "active";
  } else if (running) {
    const id = input.liveNode ?? inferRunningNode(last, dual, resumeAt);
    if (id) last.nodes[id].state = "active";
  }

  return { dual, rounds };
}

/** The node worth looking at first: what needs you, what broke, or what is running. */
export function focusNode(round: LoopRound): NodeId {
  const by = (state: NodeState) =>
    NODE_IDS.find((id) => round.nodes[id].state === state);
  const active = by("active");
  if (active) return active;
  // Once a human has decided, that decision is the round's outcome.
  if (round.decision) return "human";
  const failed = by("failed");
  if (failed) return failed;
  for (const id of [...NODE_IDS].reverse()) {
    const state = round.nodes[id].state;
    if (state === "done" || state === "warn") return id;
  }
  return "retrieve";
}
