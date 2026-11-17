import { z } from "zod";

export const PlanRiskSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1).max(500),
  mitigation: z.string().max(500).optional(),
});
export type PlanRisk = z.infer<typeof PlanRiskSchema>;

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
});
export type PlanIR = z.infer<typeof PlanIRSchema>;

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
});
export type ReviewIR = z.infer<typeof ReviewIRSchema>;

export const DualLoopModeSchema = z.enum(["off", "mock", "llm"]);
export type DualLoopMode = z.infer<typeof DualLoopModeSchema>;

export const DualLoopDxSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["mock", "llm"]),
  max_inner_refines: z.number().int(),
  planner_model: z.string().nullable().optional(),
  implementer_model: z.string().nullable().optional(),
  reviewer_model: z.string().nullable().optional(),
});
export type DualLoopDx = z.infer<typeof DualLoopDxSchema>;
