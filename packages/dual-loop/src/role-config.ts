/**
 * Separate LLM role configs for Planner / Implementer / Reviewer (M9b).
 * Keys never leave Daemon env; this module only reads process.env.
 */

export type LlmProvider = "openai" | "anthropic" | "compatible";

export type RoleLlmConfig = {
  role: "planner" | "implementer" | "reviewer";
  provider: LlmProvider;
  model: string | null;
  apiKey: string | null;
  baseUrl: string | null;
  /** True when an API key is present for this role. */
  keyConfigured: boolean;
};

function parseProvider(raw: string | undefined, fallback: LlmProvider): LlmProvider {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "openai" || v === "anthropic" || v === "compatible") return v;
  return fallback;
}

function firstEnv(env: NodeJS.ProcessEnv, names: string[]): string | null {
  for (const n of names) {
    const v = env[n];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Planner uses only SIGHTLOOP_PLANNER_* (not Implementer / shared pi keys)
 * so model configs stay separable.
 */
export function resolvePlannerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RoleLlmConfig {
  const apiKey = firstEnv(env, ["SIGHTLOOP_PLANNER_API_KEY"]);
  const model =
    firstEnv(env, ["SIGHTLOOP_PLANNER_MODEL", "SIGHTLOOP_PLANNER_LLM_MODEL"]) ??
    "gpt-4o-mini";
  const baseUrl = firstEnv(env, [
    "SIGHTLOOP_PLANNER_BASE_URL",
    "SIGHTLOOP_PLANNER_API_BASE",
  ]);
  const provider = parseProvider(
    env.SIGHTLOOP_PLANNER_PROVIDER,
    baseUrl ? "compatible" : "openai",
  );
  return {
    role: "planner",
    provider,
    model: apiKey ? model : firstEnv(env, ["SIGHTLOOP_PLANNER_MODEL", "SIGHTLOOP_PLANNER_LLM_MODEL"]),
    apiKey,
    baseUrl,
    keyConfigured: Boolean(apiKey),
  };
}

/** Reviewer defaults to Planner config; optional SIGHTLOOP_REVIEWER_* override. */
export function resolveReviewerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RoleLlmConfig {
  const planner = resolvePlannerConfig(env);
  const apiKey =
    firstEnv(env, ["SIGHTLOOP_REVIEWER_API_KEY"]) ?? planner.apiKey;
  const model =
    firstEnv(env, ["SIGHTLOOP_REVIEWER_MODEL", "SIGHTLOOP_REVIEWER_LLM_MODEL"]) ??
    planner.model ??
    "gpt-4o-mini";
  const baseUrl =
    firstEnv(env, [
      "SIGHTLOOP_REVIEWER_BASE_URL",
      "SIGHTLOOP_REVIEWER_API_BASE",
    ]) ?? planner.baseUrl;
  const provider = parseProvider(
    env.SIGHTLOOP_REVIEWER_PROVIDER ?? env.SIGHTLOOP_PLANNER_PROVIDER,
    baseUrl ? "compatible" : planner.provider,
  );
  return {
    role: "reviewer",
    provider,
    model: apiKey
      ? model
      : firstEnv(env, ["SIGHTLOOP_REVIEWER_MODEL"]) ?? planner.model,
    apiKey,
    baseUrl,
    keyConfigured: Boolean(apiKey),
  };
}

/**
 * Implementer model label / key for DX — actual act still uses AgentRunner (pi|mock).
 * Does not share Planner keys.
 */
export function resolveImplementerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RoleLlmConfig {
  const apiKey = firstEnv(env, [
    "SIGHTLOOP_IMPLEMENTER_API_KEY",
    "SIGHTLOOP_LLM_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "PI_API_KEY",
  ]);
  const model = firstEnv(env, [
    "SIGHTLOOP_IMPLEMENTER_MODEL",
    "SIGHTLOOP_LLM_MODEL",
  ]);
  const baseUrl = firstEnv(env, [
    "SIGHTLOOP_IMPLEMENTER_BASE_URL",
    "SIGHTLOOP_IMPLEMENTER_API_BASE",
  ]);
  const provider = parseProvider(
    env.SIGHTLOOP_IMPLEMENTER_PROVIDER,
    env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY ? "anthropic" : "openai",
  );
  return {
    role: "implementer",
    provider,
    model,
    apiKey,
    baseUrl,
    keyConfigured: Boolean(apiKey),
  };
}

export function dualLoopLlmAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolvePlannerConfig(env).keyConfigured;
}
