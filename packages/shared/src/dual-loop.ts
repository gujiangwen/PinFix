import { z } from "zod";

export const PlanRiskSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1).max(500),
  mitigation: z.string().max(500).optional(),
});
export type PlanRisk = z.infer<typeof PlanRiskSchema>;

/** M11a: Planner must resolve each RefineIR blocker. */
export const IssueResolutionSchema = z.object({
  issue_id: z.string().min(1).max(200),
  status: z.enum(["addressed", "reopen", "defer"]),
  rationale: z.string().max(1000).optional(),
});
export type IssueResolution = z.infer<typeof IssueResolutionSchema>;

/** M11b: executable completion contract. */
export const VerifyContractShellItemSchema = z.object({
  id: z.string().min(1).max(120),
  cmd: z.string().min(1).max(2000),
  expect_exit: z.number().int().optional(),
});
export const VerifyContractScenarioRefSchema = z.object({
  id: z.string().min(1).max(120),
  assertion_id: z.string().min(1).max(200),
});
export const VerifyContractSchema = z.object({
  shell: z.array(VerifyContractShellItemSchema).max(16).default([]),
  scenario_refs: z.array(VerifyContractScenarioRefSchema).max(32).default([]),
  require_all_green: z.boolean().default(true),
});
export type VerifyContract = z.infer<typeof VerifyContractSchema>;

export const PlanIRSchema = z.object({
  version: z.literal(1),
  session_id: z.string().min(1),
  root_cause: z.string().min(1).max(2000),
  hypothesis: z.string().max(2000).optional(),
  allowed_files: z.array(z.string().min(1)).min(1).max(32),
  forbidden_files: z.array(z.string()).max(64).optional(),
  risks: z.array(PlanRiskSchema).max(16).default([]),
  steps_hint: z.array(z.string().max(300)).max(12).default([]),
  scenario_patch: z
    .object({
      replace_steps: z.boolean().default(false),
      steps: z.array(z.unknown()).optional(),
      gates: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  planner_model: z.string().optional(),
  created_at: z.number().int().optional(),
  /** M11a */
  issue_resolutions: z.array(IssueResolutionSchema).max(40).optional(),
  /** M11b — required by planner hard rule (default filled by mock). */
  verify_contract: VerifyContractSchema.optional(),
  verify_contract_skipped_reason: z.string().max(500).optional(),
});
export type PlanIR = z.infer<typeof PlanIRSchema>;

export const RefineEvidenceSchema = z.object({
  kind: z.enum(["shell", "playwright", "diff", "console", "network", "text"]),
  file: z.string().max(500).optional(),
  line: z.number().int().optional(),
  assertion_id: z.string().max(200).optional(),
  expected: z.string().max(1000).optional(),
  actual: z.string().max(1000).optional(),
  excerpt: z.string().max(2048).optional(),
});

export const RefineBlockingIssueSchema = z.object({
  id: z.string().min(1).max(200),
  severity: z.enum(["blocker", "major", "minor"]),
  summary: z.string().min(1).max(500),
  evidence: RefineEvidenceSchema,
  related_files: z.array(z.string()).max(16).optional(),
});

export const RefineIRSchema = z.object({
  version: z.literal(1),
  source: z.enum([
    "shell_verify",
    "acceptance_gate",
    "reviewer",
    "implementer_blocked",
    "human",
    "verify_contract",
  ]),
  session_id: z.string().min(1),
  plan_id: z.string().optional(),
  blocking_issues: z.array(RefineBlockingIssueSchema).min(1).max(40),
  suggested_file_delta: z
    .object({
      add: z.array(z.string()).max(16).optional(),
      remove: z.array(z.string()).max(16).optional(),
    })
    .optional(),
  notes: z.string().max(4000).optional(),
  created_at: z.number().int(),
});
export type RefineIR = z.infer<typeof RefineIRSchema>;

export const ReviewBlockingIssueSchema = z.object({
  code: z.enum([
    "root_cause_mismatch",
    "file_scope_too_wide",
    "file_scope_too_narrow",
    "diff_unrelated",
    "verify_failed",
    "gate_failed",
    "scenario_weak",
    "security_concern",
    "other",
  ]),
  message: z.string().max(500),
});

export const PassEvidenceSchema = z.object({
  contract_item_id: z.string().min(1).max(120),
  result: z.enum(["pass", "skip"]),
  summary: z.string().max(500),
});

export const ReviewIRSchema = z.object({
  version: z.literal(1),
  session_id: z.string(),
  verdict: z.enum(["pass", "refine"]),
  notes: z.string().max(4000).default(""),
  blocking_issues: z.array(ReviewBlockingIssueSchema).max(20).default([]),
  suggested_allowed_files: z.array(z.string()).max(32).optional(),
  /** When true, next inner refine may skip planner and go implement_only. */
  implement_only: z.boolean().optional(),
  consume_gate: z.boolean().default(true),
  reviewer_model: z.string().optional(),
  /** M11b: required when verdict=pass and contract.require_all_green. */
  pass_evidence: z.array(PassEvidenceSchema).max(48).optional(),
});
export type ReviewIR = z.infer<typeof ReviewIRSchema>;

export const DualLoopModeSchema = z.enum(["off", "mock", "llm"]);
export type DualLoopMode = z.infer<typeof DualLoopModeSchema>;

export const DualLoopDxSchema = z.object({
  enabled: z.boolean(),
  /** Requested mode from SIGHTLOOP_DUAL_LOOP_MOCK (mock|llm). */
  mode: z.enum(["mock", "llm"]),
  max_inner_refines: z.number().int(),
  planner_model: z.string().nullable().optional(),
  implementer_model: z.string().nullable().optional(),
  reviewer_model: z.string().nullable().optional(),
  /** Effective backend after key detection (M9b). */
  planner_backend: z.enum(["mock", "llm"]).optional(),
  reviewer_backend: z.enum(["mock", "llm"]).optional(),
  planner_key_configured: z.boolean().optional(),
  reviewer_key_configured: z.boolean().optional(),
  /** Set when mode=llm but keys missing → mock fallback. */
  fallback_reason: z.string().nullable().optional(),
});
export type DualLoopDx = z.infer<typeof DualLoopDxSchema>;

/** Hard rule: every RefineIR blocker must be addressed|defer. */
export function assertIssueResolutionsCoverBlockers(
  refine: RefineIR | null | undefined,
  resolutions: IssueResolution[] | undefined,
): { ok: true } | { ok: false; missing: string[] } {
  if (!refine?.blocking_issues?.length) return { ok: true };
  const blockers = refine.blocking_issues.filter((i) => i.severity === "blocker");
  if (!blockers.length) return { ok: true };
  const map = new Map((resolutions ?? []).map((r) => [r.issue_id, r]));
  const missing: string[] = [];
  for (const b of blockers) {
    const r = map.get(b.id);
    if (!r || (r.status !== "addressed" && r.status !== "defer")) {
      missing.push(b.id);
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}
