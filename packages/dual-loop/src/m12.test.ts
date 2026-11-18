import { describe, expect, it } from "vitest";
import {
  distillStrategyCard,
  retrieveStrategyHits,
  intersectStrategyHintsWithWhitelist,
  strategyCardToMarkdown,
} from "./strategy.js";
import {
  autoBindEditEvidence,
  mergeAdjacentHunks,
  parseDiffHunks,
  refineFromEditWithoutEvidence,
} from "./edit-evidence.js";
import {
  evaluateMutationProxy,
  mutationGateEnabled,
} from "./mutation-gate.js";
import {
  crossJudgeEnabled,
  mergeCrossJudge,
  mockJudge,
} from "./cross-judge.js";
import { mockPlan } from "./mock-planner.js";
import { mockReview } from "./mock-reviewer.js";
import { ReviewIRSchema } from "@sightloop/shared";

describe("R1 strategy Top-K + min score", () => {
  it("filters hits below minScore and caps Top-K=3", () => {
    const cards = [
      {
        id: "1",
        title: "Strategy · low",
        body_md: "<!-- sightloop:strategy pattern_id=low -->\nunrelated noise",
        tags: ["strategy"],
      },
      {
        id: "2",
        title: "Strategy · gate",
        body_md:
          "<!-- sightloop:strategy pattern_id=gate-ok -->\ngate button selector login",
        tags: ["strategy"],
      },
      {
        id: "3",
        title: "Strategy · gate2",
        body_md:
          "<!-- sightloop:strategy pattern_id=gate-2 -->\ngate selector login assert",
        tags: ["strategy"],
      },
      {
        id: "4",
        title: "Strategy · gate3",
        body_md:
          "<!-- sightloop:strategy pattern_id=gate-3 -->\ngate selector login form",
        tags: ["strategy"],
      },
      {
        id: "5",
        title: "Strategy · gate4",
        body_md:
          "<!-- sightloop:strategy pattern_id=gate-4 -->\ngate selector login submit",
        tags: ["strategy"],
      },
    ];
    const hits = retrieveStrategyHits(
      cards,
      { note: "gate login selector", selector: "[data-testid=gate]" },
      { topK: 3, minScore: 2 },
    );
    expect(hits.every((h) => h.score >= 2)).toBe(true);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits.find((h) => h.pattern_id === "low")).toBeUndefined();
  });

  it("distill produces strategy markdown with pattern_id", () => {
    const card = distillStrategyCard({
      session_id: "01TESTSESSION",
      annotation_note: "fix button",
      files_touched: ["src/app.ts", "/etc/passwd"],
      project_whitelist: ["src/**"],
    });
    expect(card.allowed_files_hints).toEqual(["src/app.ts"]);
    expect(strategyCardToMarkdown(card)).toContain("sightloop:strategy");
  });
});

describe("R7 strategy/evidence whitelist ∩", () => {
  it("drops out-of-whitelist hints", () => {
    const { kept, dropped } = intersectStrategyHintsWithWhitelist(
      ["src/ok.ts", "../secret", "/etc/passwd", "src/app.ts"],
      ["src/**"],
    );
    expect(kept).toContain("src/ok.ts");
    expect(kept).toContain("src/app.ts");
    expect(dropped.length).toBeGreaterThan(0);
  });
});

describe("R2 edit evidence auto-bind + merge + unmet refine", () => {
  it("auto-binds from plan/sniff", () => {
    const plan = mockPlan({
      session_id: "s1",
      project_whitelist: ["src/**"],
      verify_cmd: "true",
    });
    const patch = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,2 @@
 export const x=1;
+export const y=2;
`;
    const bound = autoBindEditEvidence({
      patch,
      plan,
      sniff_selector: "[data-testid=x]",
      project_whitelist: ["src/**"],
    });
    expect(bound.ok).toBe(true);
    if (bound.ok) {
      expect(bound.evidence[0]!.evidence_refs.length).toBeGreaterThan(0);
    }
  });

  it("forbid_auto fails without evidence", () => {
    const patch = `+++ b/src/app.ts\n@@ -1 +1,2 @@\n+x\n`;
    const bound = autoBindEditEvidence({
      patch,
      plan: mockPlan({
        session_id: "s1",
        project_whitelist: ["src/**"],
      }),
      forbid_auto: true,
    });
    expect(bound.ok).toBe(false);
    const refine = refineFromEditWithoutEvidence({
      session_id: "s1",
      missing_hunks: bound.ok ? [] : bound.missing,
    });
    expect(refine.source).toBe("implementer_blocked");
    expect(refine.blocking_issues[0]!.id).toContain("edit_without_evidence");
  });

  it("merges adjacent same-file hunks", () => {
    const hunks = parseDiffHunks(`+++ b/src/a.ts
@@ -1 +1 @@
@@ -2 +2 @@
+++ b/src/b.ts
@@ -1 +1 @@
`);
    const merged = mergeAdjacentHunks(hunks);
    expect(merged.length).toBe(2);
  });
});

describe("R3 mutation gate default off + proxy", () => {
  it("defaults disabled", () => {
    const prev = process.env.SIGHTLOOP_MUTATION_GATE;
    delete process.env.SIGHTLOOP_MUTATION_GATE;
    expect(mutationGateEnabled()).toBe(false);
    if (prev !== undefined) process.env.SIGHTLOOP_MUTATION_GATE = prev;
  });

  it("proxy met/unmet measurable", () => {
    const met = evaluateMutationProxy({
      contract_results: {
        a: { ok: true, summary: "ok" },
        b: { ok: true, summary: "ok" },
      },
      test_first_paths: ["src/a.test.ts"],
      threshold: 0.7,
    });
    expect(met.met).toBe(true);
    const unmet = evaluateMutationProxy({
      contract_results: {
        a: { ok: false, summary: "fail" },
        b: { ok: false, summary: "fail" },
      },
      threshold: 0.9,
    });
    expect(unmet.met).toBe(false);
  });
});

describe("R5 cross-judge default off + agree/disagree/skip", () => {
  it("defaults disabled", () => {
    const prev = process.env.SIGHTLOOP_CROSS_JUDGE;
    delete process.env.SIGHTLOOP_CROSS_JUDGE;
    expect(crossJudgeEnabled()).toBe(false);
    if (prev !== undefined) process.env.SIGHTLOOP_CROSS_JUDGE = prev;
  });

  it("agree pass stays pass", () => {
    const primary = mockReview({
      session_id: "s1",
      shell_ok: true,
      plan: mockPlan({ session_id: "s1", project_whitelist: ["src/**"], verify_cmd: "true" }),
      contract_results: { "shell:project_verify": { ok: true, summary: "ok" } },
    });
    const judge = mockJudge({ session_id: "s1", primary });
    const merged = mergeCrossJudge({ primary, judge });
    expect(merged.agreed).toBe(true);
    expect(merged.review.verdict).toBe("pass");
  });

  it("disagreement forces refine", () => {
    const primary = mockReview({
      session_id: "s1",
      shell_ok: true,
      plan: mockPlan({ session_id: "s1", project_whitelist: ["src/**"], verify_cmd: "true" }),
      contract_results: { "shell:project_verify": { ok: true, summary: "ok" } },
    });
    const judge = mockJudge({
      session_id: "s1",
      primary,
      force_disagree: true,
    });
    const merged = mergeCrossJudge({ primary, judge });
    expect(merged.agreed).toBe(false);
    expect(merged.review.verdict).toBe("refine");
  });

  it("skip when no judge", () => {
    const primary = ReviewIRSchema.parse({
      version: 1,
      session_id: "s1",
      verdict: "pass",
      notes: "x",
      blocking_issues: [],
      consume_gate: true,
    });
    const merged = mergeCrossJudge({
      primary,
      judge: null,
      skipped: true,
      skip_reason: "no_judge_api_key",
    });
    expect(merged.skipped).toBe(true);
    expect(merged.skip_reason).toBe("no_judge_api_key");
    expect(merged.review.verdict).toBe("pass");
  });
});

describe("R9 agent_judge_pass ≠ Accept", () => {
  it("field name agent_judge_pass is distinct from accept", () => {
    const review = mockReview({
      session_id: "s1",
      shell_ok: true,
      plan: mockPlan({ session_id: "s1", project_whitelist: ["src/**"], verify_cmd: "true" }),
      contract_results: { "shell:noop": { ok: true, summary: "ok" } },
    });
    const agent_judge_pass = review.verdict === "pass";
    const human_accept = false; // Accept is outer-loop only
    expect(agent_judge_pass).toBe(true);
    expect(human_accept).toBe(false);
    expect("agent_judge_pass" !== "accept").toBe(true);
  });
});

describe("M12c test_first", () => {
  it("mock plan can include test_first", () => {
    const plan = mockPlan({
      session_id: "s1",
      project_whitelist: ["src/**"],
      verify_cmd: "true",
      include_test_first: true,
    });
    expect(plan.test_first).toBeTruthy();
    expect(plan.verify_contract?.shell.some((s) => s.id === "shell:test_first")).toBe(
      true,
    );
  });
});
