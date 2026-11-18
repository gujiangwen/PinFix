/**
 * Shared Pi LLM connection — one credential for all SightLoop roles.
 * Roles only override model (and optionally temperature later).
 */

export type PiProvider = "openai" | "anthropic" | "compatible";

export type PiConnection = {
  provider: PiProvider;
  apiKey: string | null;
  baseUrl: string | null;
  /** Default model when a role does not override. */
  defaultModel: string | null;
  keyConfigured: boolean;
};

function firstEnv(env: NodeJS.ProcessEnv, names: string[]): string | null {
  for (const n of names) {
    const v = env[n];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function parseProvider(
  raw: string | undefined,
  fallback: PiProvider,
): PiProvider {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "openai" || v === "anthropic" || v === "compatible") return v;
  return fallback;
}

/**
 * Resolve the single Pi provider credential from env.
 * Legacy per-role keys are accepted only as fallbacks so older .env still works.
 */
export function resolvePiConnection(
  env: NodeJS.ProcessEnv = process.env,
): PiConnection {
  const apiKey = firstEnv(env, [
    "PI_API_KEY",
    "SIGHTLOOP_LLM_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    // legacy role keys → migrate into shared Pi pool
    "SIGHTLOOP_IMPLEMENTER_API_KEY",
    "SIGHTLOOP_PLANNER_API_KEY",
    "SIGHTLOOP_REVIEWER_API_KEY",
    "SIGHTLOOP_JUDGE_API_KEY",
  ]);
  const baseUrl = firstEnv(env, [
    "SIGHTLOOP_PI_BASE_URL",
    "SIGHTLOOP_LLM_BASE_URL",
    "SIGHTLOOP_IMPLEMENTER_BASE_URL",
    "SIGHTLOOP_PLANNER_BASE_URL",
  ]);
  const defaultModel = firstEnv(env, [
    "SIGHTLOOP_LLM_MODEL",
    "SIGHTLOOP_PI_MODEL",
    "SIGHTLOOP_IMPLEMENTER_MODEL",
  ]);
  const provider = parseProvider(
    env.SIGHTLOOP_PI_PROVIDER ??
      env.SIGHTLOOP_LLM_PROVIDER ??
      env.SIGHTLOOP_IMPLEMENTER_PROVIDER ??
      env.SIGHTLOOP_PLANNER_PROVIDER,
    env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.PI_API_KEY
      ? "anthropic"
      : baseUrl
        ? "compatible"
        : "openai",
  );
  return {
    provider,
    apiKey,
    baseUrl,
    defaultModel,
    keyConfigured: Boolean(apiKey),
  };
}

export function hasPiCredential(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolvePiConnection(env).keyConfigured;
}
