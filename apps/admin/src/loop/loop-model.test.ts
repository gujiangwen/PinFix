import { describe, expect, it } from "vitest";
import type { AgentStep, Review } from "@sightloop/shared";
import {
  buildLoopModel,
  focusNode,
  gateSkipReason,
  nodeOfDualLoopEvent,
  nodeOfStep,
  NODE_IDS,
  type LoopRound,
  type NodeState,
} from "./loop-model";

let nextIdx = 0;

function step(
  phase: AgentStep["phase"],
  tool_name: string,
  extra: Partial<AgentStep> = {},
): AgentStep {
  const idx = nextIdx++;
  return {
    id: `step-${idx}`,
    session_id: "s1",
    idx,
    phase,
    tool_name,
    input: null,
    output: null,
    error: null,
    created_at: 1000 + idx * 10,
    ...extra,
  };
}

function review(decision: Review["decision"], created_at: number): Review {
  return { id: `r-${created_at}`, session_id: "s1", decision, note: null, created_at };
}

function states(round: LoopRound): Record<string, NodeState> {
  return Object.fromEntries(NODE_IDS.map((id) => [id, round.nodes[id].state]));
}

/** One full dual-loop pass; `verdict` is what the reviewer concluded. */
function dualRound(verdict: "pass" | "refine", fromPlanner = false): AgentStep[] {
  return [
    ...(fromPlanner ? [] : [step("retrieve", "list_knowledge")]),
    step("plan", "mock_planner"),
    step("act", "pi", { duration_ms: 400 }),
    step("act", "edit_evidence_guard", { duration_ms: 5 }),
    step("verify", "verify_contract", { output: { ok: true } }),
    step("verify", "acceptance_gate", { output: { report: { status: "passed" } } }),
    step("review", "mock_reviewer", { output: { verdict } }),
  ];
}

describe("nodeOfStep", () => {
  it("separates the acceptance gate from shell verify", () => {
    expect(nodeOfStep({ phase: "verify", tool_name: "verify_contract" })).toBe("verify");
    expect(nodeOfStep({ phase: "verify", tool_name: "acceptance_gate" })).toBe("gate");
  });

  it("files the single-loop step budget guard under implement", () => {
    expect(nodeOfStep({ phase: "plan", tool_name: "max_steps_guard" })).toBe("implement");
  });
});

describe("nodeOfDualLoopEvent", () => {
  it("maps graph node names and ignores finalize", () => {
    expect(nodeOfDualLoopEvent("planner")).toBe("plan");
    expect(nodeOfDualLoopEvent("verify_shell")).toBe("verify");
    expect(nodeOfDualLoopEvent("finalize")).toBeNull();
  });
});

describe("buildLoopModel", () => {
  it("shows an untouched track before any step exists", () => {
    const model = buildLoopModel({ session: { status: "idle" }, steps: [], reviews: [] });
    expect(model.dual).toBeNull();
    expect(model.rounds).toHaveLength(1);
    expect(new Set(Object.values(states(model.rounds[0]!)))).toEqual(new Set(["pending"]));
  });

  it("waits on the human after a clean dual-loop pass", () => {
    const model = buildLoopModel({
      session: { status: "awaiting_review" },
      steps: dualRound("pass"),
      reviews: [],
    });
    expect(model.dual).toBe(true);
    expect(model.rounds).toHaveLength(1);
    expect(states(model.rounds[0]!)).toEqual({
      retrieve: "done",
      plan: "done",
      implement: "done",
      verify: "done",
      gate: "done",
      review: "done",
      human: "active",
    });
    expect(model.rounds[0]!.nodes.implement.durationMs).toBe(405);
    expect(focusNode(model.rounds[0]!)).toBe("human");
  });

  it("starts a new round when the reviewer sends the loop back", () => {
    const model = buildLoopModel({
      session: { status: "awaiting_review" },
      steps: [...dualRound("refine"), ...dualRound("pass", true)],
      reviews: [],
    });
    expect(model.rounds).toHaveLength(2);
    expect(model.rounds[0]!.nodes.review.state).toBe("warn");
    expect(model.rounds[0]!.nodes.human.state).toBe("off");
    // The second round re-entered at the planner, so retrieve never ran in it.
    expect(model.rounds[1]!.nodes.retrieve.state).toBe("off");
    expect(model.rounds[1]!.nodes.human.state).toBe("active");
  });

  it("opens the next round as soon as the reviewer asks for a refine", () => {
    const model = buildLoopModel({
      session: { status: "acting" },
      steps: dualRound("refine"),
      reviews: [],
    });
    expect(model.rounds).toHaveLength(2);
    expect(states(model.rounds[1]!).plan).toBe("active");
  });

  it("marks the node that failed", () => {
    const model = buildLoopModel({
      session: { status: "failed" },
      steps: [
        step("retrieve", "list_knowledge"),
        step("plan", "mock_planner"),
        step("act", "pi"),
        step("verify", "verify_contract", { output: { ok: false } }),
      ],
      reviews: [],
    });
    const round = model.rounds[0]!;
    expect(round.nodes.verify.state).toBe("failed");
    expect(round.nodes.gate.state).toBe("pending");
    expect(focusNode(round)).toBe("verify");
  });

  it("treats a step error as a failure of its node", () => {
    const model = buildLoopModel({
      session: { status: "failed" },
      steps: [
        step("retrieve", "list_knowledge"),
        step("plan", "mock_planner"),
        step("act", "plan_whitelist_guard", { error: "outside whitelist" }),
      ],
      reviews: [],
    });
    expect(model.rounds[0]!.nodes.implement.state).toBe("failed");
  });

  it("infers the running node from the furthest finished one", () => {
    const model = buildLoopModel({
      session: { status: "acting" },
      steps: [step("retrieve", "list_knowledge"), step("plan", "mock_planner")],
      reviews: [],
    });
    expect(model.rounds[0]!.nodes.implement.state).toBe("active");
  });

  it("prefers the node announced over the WebSocket", () => {
    // Inference alone would say the planner; the Daemon says it skipped ahead.
    const model = buildLoopModel({
      session: { status: "acting" },
      steps: [step("retrieve", "list_knowledge")],
      reviews: [],
      liveNode: "implement",
    });
    expect(model.rounds[0]!.nodes.implement.state).toBe("active");
    expect(model.rounds[0]!.nodes.plan.state).toBe("pending");
  });

  it("puts a live node that went backwards into a new round", () => {
    const model = buildLoopModel({
      session: { status: "acting" },
      steps: dualRound("pass"),
      reviews: [],
      liveNode: "implement",
    });
    expect(model.rounds).toHaveLength(2);
    expect(model.rounds[0]!.nodes.implement.state).toBe("done");
    expect(model.rounds[1]!.nodes.implement.state).toBe("active");
  });

  it("uses the Daemon setting until the steps show which loop ran", () => {
    const early = {
      session: { status: "retrieving" as const },
      steps: [step("retrieve", "list_knowledge")],
      reviews: [],
    };
    expect(buildLoopModel(early).dual).toBeNull();
    const single = buildLoopModel({ ...early, dualHint: false });
    expect(single.dual).toBe(false);
    expect(single.rounds[0]!.nodes.plan.state).toBe("off");
    expect(single.rounds[0]!.nodes.implement.state).toBe("active");
    const dual = buildLoopModel({ ...early, dualHint: true });
    expect(dual.rounds[0]!.nodes.plan.state).toBe("active");
  });

  it("turns Planner, Reviewer and the gate off for single-loop sessions", () => {
    const model = buildLoopModel({
      session: { status: "awaiting_review" },
      steps: [
        step("retrieve", "list_knowledge"),
        step("act", "pi"),
        step("verify", "verify_cmd", { output: { ok: true } }),
      ],
      reviews: [],
    });
    expect(model.dual).toBe(false);
    expect(states(model.rounds[0]!)).toEqual({
      retrieve: "done",
      plan: "off",
      implement: "done",
      verify: "done",
      gate: "off",
      review: "off",
      human: "active",
    });
  });

  it("shows the latest gate run on a single-loop session awaiting review", () => {
    const model = buildLoopModel({
      session: { status: "awaiting_review" },
      steps: [
        step("retrieve", "list_knowledge"),
        step("act", "pi"),
        step("verify", "verify_cmd", { output: { ok: true } }),
      ],
      reviews: [],
      gateRun: { status: "failed" },
    });
    expect(model.rounds[0]!.nodes.gate.state).toBe("failed");
  });

  it("lets a newer gate run override the one recorded by the graph", () => {
    const model = buildLoopModel({
      session: { status: "awaiting_review" },
      steps: dualRound("pass"),
      reviews: [],
      gateRun: { status: "failed" },
    });
    expect(model.rounds[0]!.nodes.gate.state).toBe("failed");
  });

  describe("a gate the graph skipped", () => {
    const skipped = (reason: string): AgentStep[] => [
      step("plan", "mock_planner"),
      step("act", "pi"),
      step("verify", "verify_contract", { output: { ok: true } }),
      step("verify", "acceptance_gate", {
        output: { report: { reason } },
        duration_ms: 3,
      }),
      step("review", "mock_reviewer", { output: { verdict: "pass" } }),
    ];

    it("is off, in every round, when the project has no gate", () => {
      const first = skipped("disabled");
      const second = skipped("disabled");
      const model = buildLoopModel({
        session: { status: "awaiting_review" },
        steps: [...first, ...second],
        reviews: [review("refine", first[first.length - 1]!.created_at + 1)],
      });
      expect(model.rounds).toHaveLength(2);
      for (const round of model.rounds) {
        expect(round.nodes.gate.state).toBe("off");
        expect(round.nodes.gate.durationMs).toBeNull();
        expect(gateSkipReason(round.nodes.gate)).toBe("disabled");
      }
    });

    it("is still to come while its run is deferred until review", () => {
      const model = buildLoopModel({
        session: { status: "awaiting_review" },
        steps: skipped("deferred_to_post_act"),
        reviews: [],
      });
      expect(model.rounds[0]!.nodes.gate.state).toBe("pending");
    });

    it("takes the state of the deferred run once it exists", () => {
      const model = buildLoopModel({
        session: { status: "awaiting_review" },
        steps: skipped("deferred_to_post_act"),
        reviews: [],
        gateRun: { status: "running" },
      });
      expect(model.rounds[0]!.nodes.gate.state).toBe("active");
    });

    it("is off when the session ended before the deferred run", () => {
      const model = buildLoopModel({
        session: { status: "failed" },
        steps: skipped("deferred_to_post_act"),
        reviews: [],
      });
      expect(model.rounds[0]!.nodes.gate.state).toBe("off");
    });
  });

  it("attaches each human decision to the round it judged", () => {
    const first = dualRound("pass");
    const refineAt = first[first.length - 1]!.created_at + 5;
    const second = dualRound("pass");
    const acceptAt = second[second.length - 1]!.created_at + 5;
    const model = buildLoopModel({
      session: { status: "accepted" },
      steps: [...first, ...second],
      reviews: [review("refine", refineAt), review("accept", acceptAt)],
    });
    expect(model.rounds).toHaveLength(2);
    expect(model.rounds[0]!.decision?.decision).toBe("refine");
    expect(model.rounds[0]!.nodes.human.state).toBe("warn");
    expect(model.rounds[1]!.decision?.decision).toBe("accept");
    expect(model.rounds[1]!.nodes.human.state).toBe("done");
  });

  it("opens an empty round right after a human refine", () => {
    const first = dualRound("pass");
    const model = buildLoopModel({
      session: { status: "refined" },
      steps: first,
      reviews: [review("refine", first[first.length - 1]!.created_at + 5)],
    });
    expect(model.rounds).toHaveLength(2);
    expect(model.rounds[1]!.nodes.retrieve.state).toBe("active");
    expect(model.rounds[1]!.nodes.human.state).toBe("pending");
  });

  it("shows a revert as the end of the round", () => {
    const first = dualRound("pass");
    const model = buildLoopModel({
      session: { status: "reverted" },
      steps: first,
      reviews: [review("revert", first[first.length - 1]!.created_at + 5)],
    });
    expect(model.rounds).toHaveLength(1);
    expect(model.rounds[0]!.nodes.human.state).toBe("failed");
  });

  it("focuses the human decision of a settled round over an earlier failure", () => {
    const first = dualRound("pass");
    const model = buildLoopModel({
      session: { status: "reverted" },
      steps: first,
      reviews: [review("revert", first[first.length - 1]!.created_at + 5)],
      gateRun: { status: "error" },
    });
    const round = model.rounds[0]!;
    expect(round.nodes.gate.state).toBe("failed");
    expect(focusNode(round)).toBe("human");
  });
});
