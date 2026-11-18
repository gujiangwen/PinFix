import type { ReviewDecision, SessionStatus } from "@sightloop/shared";
import type { NodeId, NodeState } from "./loop-model";

/** i18n keys for the loop vocabulary, kept in one place so every view agrees. */

export const NODE_LABEL = {
  retrieve: "loop.node.retrieve",
  plan: "loop.node.plan",
  implement: "loop.node.implement",
  verify: "loop.node.verify",
  gate: "loop.node.gate",
  review: "loop.node.review",
  human: "loop.node.human",
} as const satisfies Record<NodeId, string>;

export const STATE_LABEL = {
  pending: "loop.state.pending",
  active: "loop.state.active",
  done: "loop.state.done",
  warn: "loop.state.warn",
  failed: "loop.state.failed",
  off: "loop.state.off",
} as const satisfies Record<NodeState, string>;

export const STATUS_LABEL = {
  idle: "status.idle",
  retrieving: "status.retrieving",
  acting: "status.acting",
  awaiting_review: "status.awaiting_review",
  accepted: "status.accepted",
  refined: "status.refined",
  reverted: "status.reverted",
  failed: "status.failed",
  distilling: "status.distilling",
} as const satisfies Record<SessionStatus, string>;

export const DECISION_LABEL = {
  accept: "loop.decision.accept",
  refine: "loop.decision.refine",
  revert: "loop.decision.revert",
} as const satisfies Record<ReviewDecision, string>;
