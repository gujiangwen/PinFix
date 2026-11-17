import { describe, expect, it } from "vitest";
import {
  assertIssueResolutionsCoverBlockers,
} from "@sightloop/shared";
import { mockPlan } from "./mock-planner.js";
import { mockReview } from "./mock-reviewer.js";
import {
  refineFromReviewer,
  refineFromShellFailure,
} from "./refine-ir.js";
import { retrieveAcceptanceHits } from "./acceptance-retrieve.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("M11a RefineIR", () => {
  it("shell failure produces blocking_issues", () => {
    const r = refineFromShellFailure({
      session_id: "s1",
      cmd: "exit 1",
      output: "boom",
    });
    expect(r.blocking_issues.length).toBeGreaterThan(0);
    expect(r.source).toBe("shell_verify");
  });

  it("planner must resolve blockers", () => {
    const refine = refineFromShellFailure({
      session_id: "s1",
      cmd: "false",
      output: "fail",
    });
    const plan = mockPlan({
      session_id: "s1",
      project_whitelist: ["src/**"],
      refine_ir: refine,
      verify_cmd: "true",
    });
    expect(plan.issue_resolutions?.length).toBeGreaterThan(0);
    const cover = assertIssueResolutionsCoverBlockers(
      refine,
      plan.issue_resolutions,
    );
    expect(cover.ok).toBe(true);
  });

  it("rejects missing resolutions", () => {
    const refine = refineFromShellFailure({ session_id: "s1", cmd: "x" });
    const bad = assertIssueResolutionsCoverBlockers(refine, []);
    expect(bad.ok).toBe(false);
  });

  it("reviewer refine → RefineIR", () => {
    const review = mockReview({
      session_id: "s1",
      shell_ok: false,
    });
    const refine = refineFromReviewer({ session_id: "s1", review });
    expect(refine.source).toBe("reviewer");
    expect(refine.blocking_issues.length).toBeGreaterThan(0);
  });
});

describe("M11b verify_contract + pass evidence", () => {
  it("mock plan always has verify_contract", () => {
    const plan = mockPlan({
      session_id: "s1",
      project_whitelist: ["src/**"],
      verify_cmd: "true",
    });
    expect(plan.verify_contract?.shell?.length).toBeGreaterThan(0);
  });

  it("pass includes pass_evidence", () => {
    const plan = mockPlan({
      session_id: "s1",
      project_whitelist: ["src/**"],
      verify_cmd: "true",
    });
    const review = mockReview({
      session_id: "s1",
      shell_ok: true,
      gate_status: "skipped",
      plan,
      contract_results: {
        "shell:project_verify": { ok: true, summary: "ok" },
      },
    });
    expect(review.verdict).toBe("pass");
    expect(review.pass_evidence?.length).toBeGreaterThan(0);
  });
});

describe("M11c acceptance retrieve", () => {
  it("finds archived scenarios by keyword", () => {
    const repo = mkdtempSync(join(tmpdir(), "sl-acc-"));
    const dir = join(repo, "acceptance", "scenarios");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "fp1.json"),
      JSON.stringify({
        fingerprint: "fp1",
        start_url: "http://127.0.0.1:5175/",
        scenario: {
          version: 1,
          start_url: "http://127.0.0.1:5175/",
          steps: [{ action: "assert_dom", selector: "[data-testid=gate-ok]" }],
        },
      }),
    );
    const hits = retrieveAcceptanceHits(repo, {
      selector: "[data-testid=gate-ok]",
      note: "gate",
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.path).toContain("acceptance/scenarios/");
  });
});
