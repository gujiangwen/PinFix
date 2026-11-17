import { z } from "zod";

export const AcceptanceCheckKindSchema = z.enum([
  "dom",
  "screenshot",
  "console",
  "network",
]);
export type AcceptanceCheckKind = z.infer<typeof AcceptanceCheckKindSchema>;

export const DomAssertTypeSchema = z.enum([
  "visible",
  "hidden",
  "text_contains",
  "attr_equals",
  "count_equals",
]);
export type DomAssertType = z.infer<typeof DomAssertTypeSchema>;

export const StructuredExpectSchema = z.object({
  type: DomAssertTypeSchema,
  selector: z.string().min(1).max(2000).optional(),
  expected: z.union([z.string(), z.number()]).optional(),
  attr: z.string().max(200).optional(),
});
export type StructuredExpect = z.infer<typeof StructuredExpectSchema>;

export const ScenarioStepActionSchema = z.enum([
  "goto",
  "click",
  "fill",
  "hover",
  "wait_for",
  "assert_dom",
  "screenshot",
]);
export type ScenarioStepAction = z.infer<typeof ScenarioStepActionSchema>;

export const ScenarioStepSchema = z.object({
  id: z.string(),
  action: ScenarioStepActionSchema,
  selector: z.string().max(2000).optional(),
  selector_alternates: z.array(z.string()).optional(),
  value: z.string().nullable().optional(),
  assert: StructuredExpectSchema.optional(),
  screenshot: z
    .object({
      name: z.string(),
      target: z.enum(["viewport", "fullpage", "locator"]).default("viewport"),
      mask: z.array(z.string()).optional(),
    })
    .optional(),
  annotation_ref: z.string().optional(),
});
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ScenarioIRSchema = z.object({
  version: z.literal(1),
  session_id: z.string(),
  start_url: z.string().url(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  steps: z.array(ScenarioStepSchema).min(1),
  gates: z.object({
    dom: z.boolean(),
    screenshot: z.boolean(),
    console: z.object({
      fail_on_error: z.boolean(),
      fail_on_warning: z.boolean().default(false),
      ignore_patterns: z.array(z.string()).default([]),
    }),
    network: z.object({
      fail_on_http_error: z.boolean(),
      ignore_url_patterns: z.array(z.string()).default([]),
    }),
  }),
});
export type ScenarioIR = z.infer<typeof ScenarioIRSchema>;

export const AcceptanceGateConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["fixture_only", "allowlist_origins"]).default("fixture_only"),
  allowed_origins: z
    .array(z.string())
    .default(["http://127.0.0.1:5175", "http://localhost:5175"]),
  require_pass_to_accept: z.boolean().default(true),
  allow_force_accept: z.boolean().default(false),
  auto_run_on_awaiting_review: z.boolean().default(true),
  screenshot: z
    .object({
      enabled: z.boolean().default(true),
      max_diff_pixel_ratio: z.number().min(0).max(1).default(0.01),
    })
    .default({}),
  console: z
    .object({
      fail_on_error: z.boolean().default(true),
      fail_on_warning: z.boolean().default(false),
      ignore_patterns: z.array(z.string()).default([]),
    })
    .default({}),
  network: z
    .object({
      fail_on_http_error: z.boolean().default(true),
      ignore_url_patterns: z.array(z.string()).default([]),
    })
    .default({}),
  timeout_ms: z.number().int().positive().default(90_000),
});
export type AcceptanceGateConfig = z.infer<typeof AcceptanceGateConfigSchema>;

export const DEFAULT_ACCEPTANCE_GATE_CONFIG: AcceptanceGateConfig =
  AcceptanceGateConfigSchema.parse({});

export const AcceptanceRunStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "error",
  "cancelled",
]);
export type AcceptanceRunStatus = z.infer<typeof AcceptanceRunStatusSchema>;

export const AcceptanceFailedStepSchema = z.object({
  id: z.string(),
  message: z.string(),
  check: AcceptanceCheckKindSchema.optional(),
});
export type AcceptanceFailedStep = z.infer<typeof AcceptanceFailedStepSchema>;

export const AcceptanceReportSchema = z.object({
  run_id: z.string(),
  session_id: z.string(),
  status: AcceptanceRunStatusSchema,
  failed_checks: z.array(AcceptanceCheckKindSchema).default([]),
  failed_steps: z.array(AcceptanceFailedStepSchema).default([]),
  console_errors: z.array(z.string()).default([]),
  network_failures: z
    .array(
      z.object({
        method: z.string(),
        url: z.string(),
        status: z.number().int(),
      }),
    )
    .default([]),
  screenshots: z
    .array(
      z.object({
        name: z.string(),
        passed: z.boolean(),
        diff_ratio: z.number().optional(),
        baseline_created: z.boolean().optional(),
      }),
    )
    .default([]),
  duration_ms: z.number().int().nullable().optional(),
  refine_note_draft: z.string().optional(),
  error: z.string().nullable().optional(),
  start_url: z.string().optional(),
  fingerprint: z.string().optional(),
  temp_commit_sha: z.string().nullable().optional(),
});
export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>;

export const AcceptanceRunSummarySchema = z.object({
  id: z.string(),
  session_id: z.string(),
  project_id: z.string(),
  status: AcceptanceRunStatusSchema,
  start_url: z.string(),
  fingerprint: z.string().nullable(),
  temp_commit_sha: z.string().nullable(),
  error: z.string().nullable(),
  started_at: z.number().int().nullable(),
  finished_at: z.number().int().nullable(),
  created_at: z.number().int(),
  report: AcceptanceReportSchema.nullable().optional(),
});
export type AcceptanceRunSummary = z.infer<typeof AcceptanceRunSummarySchema>;

export const AcceptanceGateRunInputSchema = z.object({
  reason: z.enum(["pre_accept", "manual", "post_act"]).default("manual"),
});
export type AcceptanceGateRunInput = z.infer<typeof AcceptanceGateRunInputSchema>;
