import {
  PlanIRSchema,
  assertIssueResolutionsCoverBlockers,
  type PlanIR,
  type RefineIR,
  type VerifyContract,
} from "@sightloop/shared";
import { filterPlanFilesByProject } from "./whitelist.js";

export type MockPlannerInput = {
  session_id: string;
  project_whitelist: string[];
  annotation?: { selector?: string; note?: string } | null;
  sniff?: unknown;
  human_refine_note?: string | null;
  review_notes?: string | null;
  /** Force an out-of-plan file into allowed_files for negative smoke tests. */
  force_allowed_files?: string[];
  /** M11a: prior refine evidence to absorb. */
  refine_ir?: RefineIR | null;
  /** M11b: project default verify_cmd → shell contract. */
  verify_cmd?: string | null;
  /** M11c: short acceptance archive summaries. */
  acceptance_hits?: Array<{ title: string; path: string; score?: number }>;
};

export function defaultVerifyContract(
  verifyCmd?: string | null,
): VerifyContract {
  if (verifyCmd && verifyCmd.trim()) {
    return {
      shell: [{ id: "shell:project_verify", cmd: verifyCmd.trim(), expect_exit: 0 }],
      scenario_refs: [],
      require_all_green: true,
    };
  }
  // Fixture default — explicit empty shell with require_all_green still valid;
  // mock adds a no-op true contract item so Pass evidence has something to cite.
  return {
    shell: [{ id: "shell:noop", cmd: "true", expect_exit: 0 }],
    scenario_refs: [],
    require_all_green: true,
  };
}

function resolutionsForRefine(refine: RefineIR | null | undefined) {
  if (!refine?.blocking_issues?.length) return undefined;
  return refine.blocking_issues.map((i) => ({
    issue_id: i.id,
    status: "addressed" as const,
    rationale: `Mock planner addresses ${i.id}: ${i.summary.slice(0, 120)}`,
  }));
}

/**
 * Deterministic planner: whitelist-safe files + M11a resolutions + M11b contract.
 * Never writes the business repo.
 */
export function mockPlan(input: MockPlannerInput): PlanIR {
  if (input.force_allowed_files?.length) {
    const plan = PlanIRSchema.parse({
      version: 1,
      session_id: input.session_id,
      root_cause: "smoke forced allowed_files",
      hypothesis: "test whitelist intercept",
      allowed_files: input.force_allowed_files,
      risks: [],
      steps_hint: ["edit forced file"],
      confidence: 0.5,
      planner_model: "mock-planner",
      created_at: Date.now(),
      issue_resolutions: resolutionsForRefine(input.refine_ir),
      verify_contract: defaultVerifyContract(input.verify_cmd),
    });
    const check = assertIssueResolutionsCoverBlockers(
      input.refine_ir,
      plan.issue_resolutions,
    );
    if (!check.ok) {
      throw new Error(`plan_missing_issue_resolution:${check.missing.join(",")}`);
    }
    return plan;
  }

  const candidates = [
    "src/sightloop-fix.txt",
    "src/app.ts",
    "src/App.tsx",
    "README.md",
    ...(input.refine_ir?.blocking_issues.flatMap((i) => i.related_files ?? []) ??
      []),
  ];
  let allowed = filterPlanFilesByProject(candidates, input.project_whitelist);
  if (!allowed.length && input.project_whitelist.length) {
    const w = input.project_whitelist[0]!
      .replace(/\/\*\*?$/, "")
      .replace(/\\/g, "/");
    allowed = [`${w || "src"}/sightloop-fix.txt`];
  }
  if (!allowed.length) allowed = ["src/sightloop-fix.txt"];

  const selector =
    input.annotation?.selector ??
    (typeof (input.sniff as { selector?: string } | undefined)?.selector ===
    "string"
      ? (input.sniff as { selector: string }).selector
      : "(none)");

  const notes = [input.human_refine_note, input.review_notes]
    .filter(Boolean)
    .join("\n");

  const hitNote = input.acceptance_hits?.length
    ? ` [acceptance hits: ${input.acceptance_hits
        .map((h) => h.title)
        .slice(0, 3)
        .join(", ")}]`
    : "";

  const plan = PlanIRSchema.parse({
    version: 1,
    session_id: input.session_id,
    root_cause: notes
      ? `Refine-driven: ${notes.slice(0, 200)}${hitNote}`
      : input.refine_ir?.blocking_issues?.[0]
        ? `Address refine: ${input.refine_ir.blocking_issues[0].summary.slice(0, 180)}${hitNote}`
        : `UI issue near ${selector}${hitNote}`,
    hypothesis: `Edit ${allowed[0]} to address annotation`,
    allowed_files: allowed.slice(0, 3),
    risks: [
      {
        level: "low",
        summary: "Mock plan — limited file scope",
        mitigation: "Reviewer + Human Accept",
      },
    ],
    steps_hint: [`Touch ${allowed[0]}`, "Keep changes whitelist-safe"],
    confidence: 0.7,
    planner_model: "mock-planner",
    created_at: Date.now(),
    issue_resolutions: resolutionsForRefine(input.refine_ir),
    verify_contract: defaultVerifyContract(input.verify_cmd),
  });

  const check = assertIssueResolutionsCoverBlockers(
    input.refine_ir,
    plan.issue_resolutions,
  );
  if (!check.ok) {
    throw new Error(`plan_missing_issue_resolution:${check.missing.join(",")}`);
  }
  if (!plan.verify_contract) {
    throw new Error("plan_missing_verify_contract");
  }
  return plan;
}
