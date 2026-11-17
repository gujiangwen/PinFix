import { z } from "zod";

export const RunnerModeSchema = z.enum(["mock", "pi"]);
export type RunnerMode = z.infer<typeof RunnerModeSchema>;

export const RunnerReasonSchema = z.enum([
  "no_llm_key",
  "forced_mock",
  "forced_pi",
  "llm_key_present",
  "pi_unavailable",
]);
export type RunnerReason = z.infer<typeof RunnerReasonSchema>;

export const DxStatusSchema = z.object({
  daemon: z.object({
    ok: z.boolean(),
    version: z.string(),
    bind: z.string(),
    label: z.string().optional(),
  }),
  auth: z.object({
    token_required: z.boolean(),
    token_configured: z.boolean(),
    dx_bootstrap_enabled: z.boolean(),
    token_preview: z.string().nullable().optional(),
  }),
  runner: z.object({
    mode: RunnerModeSchema,
    pi_available: z.boolean(),
    llm_key_present: z.boolean(),
    reason: RunnerReasonSchema,
  }),
  projects: z.object({
    count: z.number().int(),
    fixture_project_id: z.string().nullable(),
  }),
  paths: z.object({
    allowed_roots_configured: z.boolean(),
    data_dir: z.string().optional(),
    fixture_repo_path: z.string().nullable().optional(),
  }),
  dual_loop: z
    .object({
      enabled: z.boolean(),
      mode: z.enum(["mock", "llm"]),
      max_inner_refines: z.number().int(),
      planner_model: z.string().nullable().optional(),
      implementer_model: z.string().nullable().optional(),
      reviewer_model: z.string().nullable().optional(),
      planner_backend: z.enum(["mock", "llm"]).optional(),
      reviewer_backend: z.enum(["mock", "llm"]).optional(),
      planner_key_configured: z.boolean().optional(),
      reviewer_key_configured: z.boolean().optional(),
      fallback_reason: z.string().nullable().optional(),
    })
    .optional(),
});
export type DxStatus = z.infer<typeof DxStatusSchema>;

export const DxBootstrapResponseSchema = z.object({
  ok: z.boolean(),
  dx_bootstrap_enabled: z.boolean(),
  token_configured: z.boolean(),
  /** Last 4 chars only when bootstrap is enabled — never the full secret. */
  token_preview: z.string().nullable(),
  /** Full token only when SIGHTLOOP_DX_BOOTSTRAP=1 (local DX). */
  token: z.string().nullable().optional(),
  daemon_url: z.string(),
  hint: z.string().optional(),
});
export type DxBootstrapResponse = z.infer<typeof DxBootstrapResponseSchema>;

export const DxEnsureFixtureInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  origin_pattern: z.string().min(1).max(512).optional(),
  mode: z.enum(["hmr", "pr"]).optional(),
  /** Absolute override; must fall under allowed roots. */
  repo_path: z.string().min(1).optional(),
});
export type DxEnsureFixtureInput = z.infer<typeof DxEnsureFixtureInputSchema>;

export const DxEnsureFixtureResponseSchema = z.object({
  project_id: z.string(),
  created: z.boolean(),
  project: z.object({
    id: z.string(),
    name: z.string(),
    repo_path: z.string(),
    origin_pattern: z.string(),
    mode: z.enum(["hmr", "pr"]),
  }),
  fixture_hint: z.string(),
});
export type DxEnsureFixtureResponse = z.infer<
  typeof DxEnsureFixtureResponseSchema
>;
