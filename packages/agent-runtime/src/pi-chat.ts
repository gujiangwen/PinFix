import {
  resolvePiConnection,
  type PiConnection,
  type PiProvider,
} from "./pi-connection.js";

export type PiChatOptions = {
  system: string;
  user: string;
  /** Role model override; falls back to Pi default model. */
  model?: string | null;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Inject connection for tests. */
  connection?: PiConnection;
  fetchImpl?: typeof fetch;
};

export class PiChatError extends Error {
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
    this.name = "PiChatError";
  }
}

function defaultBaseUrl(provider: PiProvider, baseUrl: string | null): string {
  if (baseUrl) return baseUrl.replace(/\/$/, "");
  if (provider === "anthropic") return "https://api.anthropic.com";
  return "https://api.openai.com/v1";
}

/**
 * Structured chat for Planner / Reviewer / Judge via the shared Pi credential.
 * Uses the same provider APIs Pi is configured with (OpenAI / Anthropic / compatible).
 * Implementer coding edits still go through the Pi CLI AgentRunner.
 */
export async function piChatText(opts: PiChatOptions): Promise<string> {
  const connection = opts.connection ?? resolvePiConnection(opts.env);
  if (!connection.apiKey) {
    throw new PiChatError("Missing Pi API key", "no_api_key");
  }
  const model = (opts.model?.trim() || connection.defaultModel || "gpt-4o-mini");
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = defaultBaseUrl(connection.provider, connection.baseUrl);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    if (connection.provider === "anthropic") {
      const res = await fetchImpl(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new PiChatError(
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
      if (!text) throw new PiChatError("Empty Anthropic response", "empty_response");
      return text;
    }

    const res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${connection.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PiChatError(
        `OpenAI-compatible HTTP ${res.status}: ${body.slice(0, 400)}`,
        "http_error",
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new PiChatError("Empty chat completion", "empty_response");
    return text;
  } catch (err) {
    if (err instanceof PiChatError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new PiChatError(`Pi chat timeout after ${timeoutMs}ms`, "timeout");
    }
    throw new PiChatError((err as Error).message ?? String(err), "http_error");
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
    throw new PiChatError("No JSON object in model output", "parse_error");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new PiChatError(
      `JSON parse failed: ${(err as Error).message}`,
      "parse_error",
    );
  }
}
