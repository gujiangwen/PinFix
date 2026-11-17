import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  hasLlmApiKey,
} from "@sightloop/agent-runtime";
import type { RunnerMode, RunnerReason } from "@sightloop/shared";

export type RunnerStatus = {
  mode: RunnerMode;
  pi_available: boolean;
  llm_key_present: boolean;
  reason: RunnerReason;
};

function detectPiAvailable(): boolean {
  try {
    const req = createRequire(import.meta.url);
    // Prefer resolving the package; fall back to common bin locations.
    try {
      req.resolve("@mariozechner/pi-coding-agent/package.json");
      return true;
    } catch {
      // continue
    }
    const candidates = [
      join(process.cwd(), "node_modules", ".bin", "pi"),
      join(dirname(process.cwd()), ".bin", "pi"),
    ];
    return candidates.some((p) => existsSync(p));
  } catch {
    return false;
  }
}

export function getRunnerStatus(
  env: NodeJS.ProcessEnv = process.env,
): RunnerStatus {
  const force = (env.SIGHTLOOP_AGENT_RUNNER ?? "").toLowerCase();
  const llm_key_present = hasLlmApiKey(env);
  const pi_available = detectPiAvailable();

  if (force === "mock") {
    return {
      mode: "mock",
      pi_available,
      llm_key_present,
      reason: "forced_mock",
    };
  }
  if (force === "pi") {
    return {
      mode: pi_available || llm_key_present ? "pi" : "mock",
      pi_available,
      llm_key_present,
      reason: pi_available || llm_key_present ? "forced_pi" : "pi_unavailable",
    };
  }
  if (llm_key_present) {
    return {
      mode: "pi",
      pi_available,
      llm_key_present: true,
      reason: pi_available ? "llm_key_present" : "pi_unavailable",
    };
  }
  return {
    mode: "mock",
    pi_available,
    llm_key_present: false,
    reason: "no_llm_key",
  };
}
