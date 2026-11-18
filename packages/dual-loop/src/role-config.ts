/**
 * Pi-centric role configs: one shared credential; roles only pick models.
 */

import {
  resolvePiConnection,
  type PiProvider,
} from "@sightloop/agent-runtime";

export type LlmProvider = PiProvider;

export type RoleLlmConfig = {
  role: "planner" | "implementer" | "reviewer" | "judge";
  provider: LlmProvider;
  model: string | null;
  /** Always the shared Pi key (never a separate per-role secret). */
  apiKey: string | null;
  baseUrl: string | null;
  /** True when the shared Pi API key is present. */
  keyConfigured: boolean;
};

function firstEnv(env: NodeJS.ProcessEnv, names: string[]): string | null {
  for (const n of names) {
    const v = env[n];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function roleModel(
  env: NodeJS.ProcessEnv,
  roleKeys: string[],
  fallback: string | null,
): string | null {
  return firstEnv(env, roleKeys) ?? fallback;
}

function fromPi(
  env: NodeJS.ProcessEnv,
  role: RoleLlmConfig["role"],
  modelKeys: string[],
): RoleLlmConfig {
  const pi = resolvePiConnection(env);
  const model = roleModel(env, modelKeys, pi.defaultModel);
  return {
    role,
    provider: pi.provider,
    model: pi.keyConfigured ? model ?? "gpt-4o-mini" : model,
    apiKey: pi.apiKey,
    baseUrl: pi.baseUrl,
    keyConfigured: pi.keyConfigured,
  };
}

/** Planner — shared Pi key + optional SIGHTLOOP_PLANNER_MODEL. */
export function resolvePlannerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RoleLlmConfig {
  return fromPi(env, "planner", [
    "SIGHTLOOP_PLANNER_MODEL",
    "SIGHTLOOP_PLANNER_LLM_MODEL",
  ]);
}

/** Reviewer — shared Pi key + optional SIGHTLOOP_REVIEWER_MODEL (else planner model). */
export function resolveReviewerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RoleLlmConfig {
  const planner = resolvePlannerConfig(env);
  const model =
    firstEnv(env, ["SIGHTLOOP_REVIEWER_MODEL", "SIGHTLOOP_REVIEWER_LLM_MODEL"]) ??
    planner.model;
  return {
    ...planner,
    role: "reviewer",
    model: planner.keyConfigured ? model ?? "gpt-4o-mini" : model,
  };
}

/**
 * Implementer — shared Pi key + optional SIGHTLOOP_IMPLEMENTER_MODEL.
 * Actual act still uses AgentRunner (pi|mock).
 */
export function resolveImplementerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RoleLlmConfig {
  return fromPi(env, "implementer", [
    "SIGHTLOOP_IMPLEMENTER_MODEL",
    "SIGHTLOOP_LLM_MODEL",
  ]);
}

/** Judge — shared Pi key + optional SIGHTLOOP_JUDGE_MODEL (else planner model). */
export function resolveJudgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RoleLlmConfig {
  const planner = resolvePlannerConfig(env);
  const model =
    firstEnv(env, ["SIGHTLOOP_JUDGE_MODEL", "SIGHTLOOP_JUDGE_LLM_MODEL"]) ??
    planner.model;
  return {
    ...planner,
    role: "judge",
    model: planner.keyConfigured ? model ?? "gpt-4o-mini" : model,
  };
}

export function dualLoopLlmAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolvePiConnection(env).keyConfigured;
}
