import type { AgentRunner } from "./runners/types.js";
import { createMockRunner } from "./runners/mock.js";
import { createPiRunner } from "./runners/pi.js";

/** True when a cloud LLM key is present for pi / provider use. */
export function hasLlmApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.OPENAI_API_KEY ||
      env.ANTHROPIC_API_KEY ||
      env.SIGHTLOOP_LLM_API_KEY ||
      env.PI_API_KEY,
  );
}

/**
 * Prefer pi when an API key is configured; otherwise mock/dry-run so
 * Accept/Refine/Revert demos still work without secrets.
 */
export function selectAgentRunner(
  env: NodeJS.ProcessEnv = process.env,
): AgentRunner {
  const force = (env.SIGHTLOOP_AGENT_RUNNER ?? "").toLowerCase();
  if (force === "mock") return createMockRunner();
  if (force === "pi") return createPiRunner();
  if (hasLlmApiKey(env)) return createPiRunner();
  return createMockRunner();
}
