import { describe, expect, it } from "vitest";
import type { AgentStep, Session } from "@sightloop/shared";
import { buildLoopModel } from "./loop-model";
import { buildQueues, placeSession, roleFromModel, ROLES } from "./queues";
import { buildRoleStages } from "./role-stage";

function session(partial: Partial<Session> & Pick<Session, "id" | "status" | "created_at">): Session {
  return {
    project_id: "p",
    page_url: "http://127.0.0.1/",
    sniff: null,
    annotation_ref: null,
    annotation: { note: "Fix the button" },
    max_steps: 3,
    step_count: 0,
    git_base_sha: null,
    temp_commit_sha: null,
    updated_at: partial.created_at,
    ...partial,
  };
}

let idx = 0;
function step(
  phase: AgentStep["phase"],
  tool_name: string,
  extra: Partial<AgentStep> = {},
): AgentStep {
  const n = idx++;
  return {
    id: `step-${n}`,
    session_id: "s",
    idx: n,
    phase,
    tool_name,
    input: null,
    output: null,
    error: null,
    created_at: 1_000 + n,
    ...extra,
  };
}

describe("placeSession", () => {
  it("keeps finished sessions out of every queue", () => {
    expect(placeSession(session({ id: "a", status: "accepted", created_at: 1 }), null)).toBeNull();
    expect(placeSession(session({ id: "b", status: "failed", created_at: 1 }), null)).toBeNull();
    expect(placeSession(session({ id: "c", status: "distilling", created_at: 1 }), null)).toBeNull();
  });

  it("does not invent a running head", () => {
    const older = placeSession(session({ id: "old", status: "idle", created_at: 1 }), null);
    const newer = placeSession(session({ id: "new", status: "retrieving", created_at: 2 }), null);
    const queues = buildQueues([older!, newer!]);
    const planner = queues[0]!;
    expect(planner.tasks.map((task) => task.session.id)).toEqual(["old", "new"]);
    expect(planner.tasks[0]?.executing).toBe(false);
    expect(planner.tasks[1]?.executing).toBe(true);
    expect(planner.state).toBe("running");
    expect(planner.runningCount).toBe(1);
    expect(planner.waitingCount).toBe(1);
    expect(queues[1]?.state).toBe("idle");
    expect(queues[2]?.waitingCount).toBe(0);
  });

  it("puts a human pass/reject on Reviewer, not a fourth queue", () => {
    const waiting = placeSession(
      session({ id: "rev", status: "awaiting_review", created_at: 3 }),
      null,
    );
    const queues = buildQueues([waiting!]);
    expect(queues.map((queue) => queue.role)).toEqual([...ROLES]);
    expect(queues[2]?.tasks).toHaveLength(1);
    expect(queues[2]?.state).toBe("idle");
    expect(queues[2]?.runningCount).toBe(0);
    expect(queues[2]?.waitingCount).toBe(1);
  });
});

describe("roleFromModel", () => {
  it("reads an in-progress acting session from its steps", () => {
    const model = buildLoopModel({
      session: { status: "acting" },
      steps: [step("retrieve", "list_knowledge"), step("plan", "mock_planner")],
      reviews: [],
      dualHint: true,
    });
    expect(roleFromModel(model)).toBe("implementer");
    const placed = placeSession(
      session({ id: "act", status: "acting", created_at: 4 }),
      roleFromModel(model),
    );
    expect(placed).toMatchObject({ role: "implementer", executing: true });
  });
});

describe("buildRoleStages", () => {
  it("folds a backend Judge record into Reviewer", () => {
    const model = buildLoopModel({
      session: { status: "awaiting_review" },
      steps: [
        step("review", "mock_reviewer", {
          duration_ms: 800,
          output: {
            verdict: "pass",
            notes: "Matches the contract.",
            judge_skipped: false,
            judge_skip_reason: null,
            agent_judge_pass: true,
          },
        }),
      ],
      reviews: [],
    });
    const stages = buildRoleStages({
      session: session({ id: "s", status: "awaiting_review", created_at: 5 }),
      round: model.rounds[model.rounds.length - 1]!,
      plan: null,
      review: null,
      recall: [],
      gateStatus: null,
    });
    expect(Object.keys(stages)).toEqual(["planner", "implementer", "reviewer"]);
    expect(stages.reviewer.output).toEqual([
      { k: "verdict", v: "pass" },
      { k: "notes", v: "Matches the contract." },
    ]);
    expect(stages.reviewer.judge).toEqual({
      skipped: false,
      reason: null,
      agentPass: true,
    });
    expect(stages.reviewer.durationMs).toBe(800);
    expect(stages.reviewer.state).toBe("waiting");
  });
});
