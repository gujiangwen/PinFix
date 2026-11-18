import type { AgentRunner } from "./runners/types.js";
import { createMockRunner } from "./runners/mock.js";
import { createPiRunner } from "./runners/pi.js";
import { hasPiCredential } from "./pi-connection.js";

/** True when the shared Pi credential is configured. */
export function hasLlmApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasPiCredential(env);
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
