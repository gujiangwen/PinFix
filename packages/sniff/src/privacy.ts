/** Prop / attribute keys that must never be serialized from host apps. */
export const PROP_BLACKLIST = [
  "password",
  "passwd",
  "pwd",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "authorization",
  "auth",
  "cookie",
  "cookies",
  "secret",
  "apiKey",
  "api_key",
  "apikey",
  "privateKey",
  "private_key",
  "sessionId",
  "session_id",
  "csrf",
  "csrfToken",
  "creditCard",
  "credit_card",
  "ssn",
] as const;

const BLACKLIST_SET = new Set(
  PROP_BLACKLIST.map((k) => k.toLowerCase()),
);

export function isBlacklistedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (BLACKLIST_SET.has(lower)) return true;
  // Heuristic: *password*, *token*, *secret*
  return (
    lower.includes("password") ||
    lower.includes("secret") ||
    lower.endsWith("token") ||
    lower.includes("authorization")
  );
}

const MAX_PROP_STRING = 200;
const MAX_PROPS = 24;

/** Shallow, privacy-filtered summary of component props. */
export function summarizeProps(
  props: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!props || typeof props !== "object") return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key.startsWith("_")) continue;
    if (isBlacklistedKey(key)) {
      out[key] = "[redacted]";
      count += 1;
      if (count >= MAX_PROPS) break;
      continue;
    }
    out[key] = sanitizeValue(value);
    count += 1;
    if (count >= MAX_PROPS) break;
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    return s.length > MAX_PROP_STRING
      ? `${s.slice(0, MAX_PROP_STRING)}…`
      : s;
  }
  if (t === "number" || t === "boolean") return value;
  if (t === "function") return `[fn ${(value as Function).name || "anonymous"}]`;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (t === "object") {
    const tag = Object.prototype.toString.call(value);
    if (tag === "[object Object]") return "[object]";
    return tag;
  }
  return String(value);
}
