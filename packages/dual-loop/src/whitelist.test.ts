import { describe, expect, it } from "vitest";
import { assertWriteAllowed, filterPlanFilesByProject, isExactAllowed } from "./whitelist.js";
import { mockPlan } from "./mock-planner.js";
import { mockReview } from "./mock-reviewer.js";

describe("plan whitelist", () => {
  it("exact match only", () => {
    expect(isExactAllowed("src/a.ts", ["src/a.ts"])).toBe(true);
    expect(isExactAllowed("src/a.ts", ["src/"])).toBe(false);
    expect(isExactAllowed("src/a.ts", ["src/**"])).toBe(false);
  });

  it("filters plan files by project glob", () => {
    expect(
      filterPlanFilesByProject(
        ["src/a.ts", "README.md"],
        ["src/**"],
      ),
    ).toEqual(["src/a.ts"]);
  });

  it("assertWriteAllowed blocks non-plan files", () => {
    const r = assertWriteAllowed(
      "/tmp/repo",
      "src/other.ts",
      ["src/a.ts"],
      ["src/**"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("plan_whitelist_blocked");
  });
});

describe("mock planner/reviewer", () => {
  it("produces valid PlanIR", () => {
    const plan = mockPlan({
      session_id: "s1",
      project_whitelist: ["src/**"],
      annotation: { selector: "[data-testid=x]", note: "fix" },
    });
    expect(plan.allowed_files.length).toBeGreaterThan(0);
    expect(plan.version).toBe(1);
  });

  it("reviewer refines on shell fail", () => {
    const r = mockReview({
      session_id: "s1",
      shell_ok: false,
    });
    expect(r.verdict).toBe("refine");
  });

  it("reviewer passes when clean", () => {
    const r = mockReview({
      session_id: "s1",
      shell_ok: true,
      gate_status: "skipped",
    });
    expect(r.verdict).toBe("pass");
  });
});
