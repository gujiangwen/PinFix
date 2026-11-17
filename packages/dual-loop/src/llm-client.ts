import type { LlmProvider, RoleLlmConfig } from "./role-config.js";

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

function defaultBaseUrl(provider: LlmProvider, baseUrl: string | null): string {
  if (baseUrl) return baseUrl.replace(/\/$/, "");
  if (provider === "anthropic") return "https://api.anthropic.com";
  return "https://api.openai.com/v1";
}

/**
 * Thin chat → text helper for Planner/Reviewer structured JSON.
 * OpenAI-compatible `/chat/completions` or Anthropic `/v1/messages`.
 */
export async function chatText(opts: ChatJsonOptions): Promise<string> {
  const { config, system, user } = opts;
  if (!config.apiKey) {
    throw new LlmClientError("Missing API key for role " + config.role, "no_api_key");
  }
  const model = config.model || "gpt-4o-mini";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = defaultBaseUrl(config.provider, config.baseUrl);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    if (config.provider === "anthropic") {
      const res = await fetchImpl(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new LlmClientError(
          `Anthropic HTTP ${res.status}: ${body.slice(0, 400)}`,
          "http_error",
        );
      }
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = (data.content ?? [])
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n")
        .trim();
      if (!text) throw new LlmClientError("Empty Anthropic response", "empty_response");
      return text;
    }

    // openai + compatible
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmClientError(
        `OpenAI-compatible HTTP ${res.status}: ${body.slice(0, 400)}`,
        "http_error",
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new LlmClientError("Empty chat completion", "empty_response");
    return text;
  } catch (err) {
    if (err instanceof LlmClientError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new LlmClientError(`LLM timeout after ${timeoutMs}ms`, "timeout");
    }
    throw new LlmClientError((err as Error).message ?? String(err), "http_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Extract first JSON object from model text (fenced or raw). */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new LlmClientError("No JSON object in model output", "parse_error");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new LlmClientError(
      `JSON parse failed: ${(err as Error).message}`,
      "parse_error",
    );
  }
}
