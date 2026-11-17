import { PlanIRSchema, type PlanIR } from "@sightloop/shared";
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
};

/**
 * Deterministic M9a planner: pick 1–3 whitelist-safe files from heuristics.
 * Never writes the business repo.
 */
export function mockPlan(input: MockPlannerInput): PlanIR {
  if (input.force_allowed_files?.length) {
    return PlanIRSchema.parse({
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
    });
  }

  const candidates = [
    "src/sightloop-fix.txt",
    "src/app.ts",
    "src/App.tsx",
    "README.md",
  ];
  let allowed = filterPlanFilesByProject(candidates, input.project_whitelist);
  if (!allowed.length && input.project_whitelist.length) {
    // Derive a concrete file under first glob.
    const w = input.project_whitelist[0]!.replace(/\/\*\*?$/, "").replace(/\\/g, "/");
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

  return PlanIRSchema.parse({
    version: 1,
    session_id: input.session_id,
    root_cause: notes
      ? `Refine-driven: ${notes.slice(0, 200)}`
      : `UI issue near ${selector}`,
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
  });
}
