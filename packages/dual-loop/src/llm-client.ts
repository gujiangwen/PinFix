/**
 * Pi-backed chat for dual-loop Planner / Reviewer / Judge.
 * Credentials always come from the shared Pi connection; `config.model` is the role pick.
 */
import {
  piChatText,
  extractJsonObject,
  PiChatError,
  resolvePiConnection,
} from "@sightloop/agent-runtime";
import type { RoleLlmConfig } from "./role-config.js";

export type ChatJsonOptions = {
  config: RoleLlmConfig;
  system: string;
  user: string;
  timeoutMs?: number;
  /** Inject for tests. */
  fetchImpl?: typeof fetch;
};

export class LlmClientError extends Error {
  constructor(
    message: string,
    readonly code:
      | "no_api_key"
      | "http_error"
      | "empty_response"
      | "timeout"
      | "parse_error",
  ) {
    super(message);
    this.name = "LlmClientError";
  }
}

function mapErr(err: unknown): LlmClientError {
  if (err instanceof LlmClientError) return err;
  if (err instanceof PiChatError) {
    return new LlmClientError(err.message, err.code);
  }
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  return new LlmClientError(message, "http_error");
}

/**
 * Chat → text via shared Pi credentials (same provider APIs Pi uses).
 */
export async function chatText(opts: ChatJsonOptions): Promise<string> {
  const pi = resolvePiConnection(process.env);
  // Prefer shared Pi key; RoleLlmConfig.apiKey is already the shared key.
  if (!opts.config.apiKey && !pi.apiKey) {
    throw new LlmClientError(
      "Missing Pi API key for role " + opts.config.role,
      "no_api_key",
    );
  }
  try {
    return await piChatText({
      system: opts.system,
      user: opts.user,
      model: opts.config.model,
      timeoutMs: opts.timeoutMs,
      connection: {
        provider: opts.config.provider,
        apiKey: opts.config.apiKey ?? pi.apiKey,
        baseUrl: opts.config.baseUrl ?? pi.baseUrl,
        defaultModel: pi.defaultModel,
        keyConfigured: Boolean(opts.config.apiKey ?? pi.apiKey),
      },
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    throw mapErr(err);
  }
}

export { extractJsonObject };
