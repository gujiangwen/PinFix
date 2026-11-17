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
