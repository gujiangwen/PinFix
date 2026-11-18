import type { PlanIR, ReviewIR, Session } from "@sightloop/shared";
import type { LoopRound, NodeId } from "./loop-model";
import { ROLES, type RoleId } from "./queues";

/** Nodes folded into each home stage. Judge is not its own stage. */
const STAGE_NODES: Record<RoleId, readonly NodeId[]> = {
  planner: ["retrieve", "plan"],
  implementer: ["implement", "verify"],
  reviewer: ["gate", "review", "human"],
};

export type StageState =
  | "pending"
  | "active"
  | "waiting"
  | "done"
  | "warn"
  | "failed"
  | "off";

export type StageFact =
  | { k: "note"; v: string }
  | { k: "page"; v: string }
  | { k: "files"; v: string[] }
  | { k: "cause"; v: string }
  | { k: "summary"; v: string }
  | { k: "verdict"; v: string }
  | { k: "notes"; v: string }
  | { k: "decision"; v: string }
  | { k: "verify"; v: "ok" | "failed" }
  | { k: "gate"; v: string }
  | { k: "recall"; v: string[] };

/** Present when the review step still carries a backend Judge record. */
export type FoldedJudge = {
  skipped: boolean;
  reason: string | null;
  agentPass: boolean | null;
};

export type RoleStage = {
  role: RoleId;
  state: StageState;
  input: StageFact[];
  output: StageFact[];
  durationMs: number | null;
  startedAt: number | null;
  judge: FoldedJudge | null;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function lastOutput(
  round: LoopRound,
  ids: readonly NodeId[],
): Record<string, unknown> | null {
  const steps = ids.flatMap((id) => round.nodes[id].steps);
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const output = rec(steps[i]?.output);
    if (output) return output;
  }
  return null;
}

function stageState(
  role: RoleId,
  round: LoopRound,
  status: Session["status"],
): StageState {
  const nodes = STAGE_NODES[role].map((id) => round.nodes[id]);
  if (nodes.some((node) => node.state === "failed")) return "failed";
  // A human decision is waiting, not the agent executing.
  const agentActive = nodes.some(
    (node) => node.id !== "human" && node.state === "active",
  );
  if (agentActive) return "active";
  if (role === "reviewer" && status === "awaiting_review" && !round.decision) {
    return "waiting";
  }
  if (nodes.some((node) => node.state === "warn")) return "warn";
  const meaningful = nodes.filter((node) => node.state !== "off");
  if (meaningful.some((node) => node.state === "done")) return "done";
  if (nodes.every((node) => node.state === "off")) return "off";
  return "pending";
}

function timing(round: LoopRound, ids: readonly NodeId[]): {
  durationMs: number | null;
  startedAt: number | null;
} {
  const steps = ids.flatMap((id) => round.nodes[id].steps);
  if (steps.length === 0) return { durationMs: null, startedAt: null };
  const timed = steps.filter((step) => step.duration_ms != null);
  const durationMs = timed.length
    ? timed.reduce((sum, step) => sum + (step.duration_ms ?? 0), 0)
    : null;
  const startedAt = steps.reduce(
    (min, step) => Math.min(min, step.created_at),
    Number.POSITIVE_INFINITY,
  );
  return { durationMs, startedAt: Number.isFinite(startedAt) ? startedAt : null };
}

function foldedJudge(round: LoopRound): FoldedJudge | null {
  const output = lastOutput(round, ["review"]);
  if (!output) return null;
  if (!("judge_skipped" in output) && !("agent_judge_pass" in output)) return null;
  return {
    skipped: output.judge_skipped === true,
    reason: str(output.judge_skip_reason),
    agentPass: typeof output.agent_judge_pass === "boolean" ? output.agent_judge_pass : null,
  };
}

function plannerFacts(
  session: Session,
  round: LoopRound,
  plan: PlanIR | null,
  recall: string[],
): { input: StageFact[]; output: StageFact[] } {
  const input: StageFact[] = [];
  const note = session.annotation?.note?.trim();
  if (note) input.push({ k: "note", v: note });
  if (session.page_url) input.push({ k: "page", v: session.page_url });
  if (recall.length > 0) input.push({ k: "recall", v: recall });

  const output = lastOutput(round, ["plan"]);
  const cause = str(output?.root_cause) ?? plan?.root_cause ?? null;
  const files = strings(output?.allowed_files);
  const fileList = files.length > 0 ? files : (plan?.allowed_files ?? []);
  const out: StageFact[] = [];
  if (cause) out.push({ k: "cause", v: cause });
  if (fileList.length > 0) out.push({ k: "files", v: fileList });
  return { input, output: out };
}

function implementerFacts(
  round: LoopRound,
  plan: PlanIR | null,
): { input: StageFact[]; output: StageFact[] } {
  const planOutput = lastOutput(round, ["plan"]);
  const files = strings(planOutput?.allowed_files);
  const fileList = files.length > 0 ? files : (plan?.allowed_files ?? []);
  const input: StageFact[] = fileList.length > 0 ? [{ k: "files", v: fileList }] : [];

  const act = [...round.nodes.implement.steps].reverse().find((step) => {
    const tool = step.tool_name ?? "";
    return !tool.endsWith("_guard");
  });
  const actOutput = rec(act?.output);
  const verify = lastOutput(round, ["verify"]);
  const out: StageFact[] = [];
  const summary = act?.summary?.trim() || str(actOutput?.summary);
  if (summary) out.push({ k: "summary", v: summary });
  const touched = strings(actOutput?.filesTouched);
  if (touched.length > 0) out.push({ k: "files", v: touched });
  if (verify && typeof verify.ok === "boolean") {
    out.push({ k: "verify", v: verify.ok ? "ok" : "failed" });
  }
  return { input, output: out };
}

function reviewerFacts(
  round: LoopRound,
  review: ReviewIR | null,
  gateRunStatus: string | null,
): { input: StageFact[]; output: StageFact[] } {
  const gate = lastOutput(round, ["gate"]);
  const report = rec(gate?.report);
  const fromStep = str(report?.status) ?? str(gate?.status);
  const reason = str(report?.reason);
  const gateStatus =
    fromStep && fromStep !== "skipped" ? fromStep : (gateRunStatus ?? reason);
  const input: StageFact[] = gateStatus ? [{ k: "gate", v: gateStatus }] : [];

  const output = lastOutput(round, ["review"]);
  const verdict = str(output?.verdict) ?? review?.verdict ?? null;
  const notes = str(output?.notes) ?? (review?.notes?.trim() ? review.notes : null);
  const out: StageFact[] = [];
  if (verdict) out.push({ k: "verdict", v: verdict });
  if (notes) out.push({ k: "notes", v: notes });
  if (round.decision) out.push({ k: "decision", v: round.decision.decision });
  return { input, output: out };
}

export function buildRoleStages(input: {
  session: Session;
  round: LoopRound;
  plan: PlanIR | null;
  review: ReviewIR | null;
  recall: string[];
  /** Latest acceptance-gate run, when the step itself only recorded a skip. */
  gateStatus: string | null;
}): Record<RoleId, RoleStage> {
  const stages = {} as Record<RoleId, RoleStage>;
  for (const role of ROLES) {
    const facts =
      role === "planner"
        ? plannerFacts(input.session, input.round, input.plan, input.recall)
        : role === "implementer"
          ? implementerFacts(input.round, input.plan)
          : reviewerFacts(input.round, input.review, input.gateStatus);
    const time = timing(input.round, STAGE_NODES[role]);
    stages[role] = {
      role,
      state: stageState(role, input.round, input.session.status),
      input: facts.input,
      output: facts.output,
      durationMs: time.durationMs,
      startedAt: time.startedAt,
      judge: role === "reviewer" ? foldedJudge(input.round) : null,
    };
  }
  return stages;
}
