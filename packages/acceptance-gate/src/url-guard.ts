import type { AcceptanceGateConfig } from "@sightloop/shared";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export type UrlGuardResult =
  | { ok: true; url: URL; origin: string }
  | { ok: false; code: string; message: string };

/** M8a: only http://127.0.0.1|localhost with origin in allowlist / fixture ports. */
export function assertFixtureUrl(
  pageUrl: string,
  config: AcceptanceGateConfig,
): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return { ok: false, code: "invalid_url", message: `Invalid page_url: ${pageUrl}` };
  }

  if (url.protocol === "file:") {
    return { ok: false, code: "url_rejected", message: "file:// URLs are forbidden" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      code: "url_rejected",
      message: `Unsupported protocol ${url.protocol}`,
    };
  }

  if (config.mode === "fixture_only") {
    if (url.protocol !== "http:") {
      return {
        ok: false,
        code: "url_rejected",
        message: "M8a fixture-only gate allows http:// loopback only",
      };
    }
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      return {
        ok: false,
        code: "url_rejected",
        message:
          "M8a only supports fixture origins (127.0.0.1 / localhost). Bind business domains in M8b.",
      };
    }
  }

  const origin = `${url.protocol}//${url.host}`;
  const allowed = (config.allowed_origins ?? []).map((o) => o.replace(/\/$/, ""));
  if (allowed.length && !allowed.includes(origin)) {
    // Also accept exact start_url origin if it matches allowed with trailing path stripped
    const matched = allowed.some((a) => {
      try {
        const u = new URL(a);
        return `${u.protocol}//${u.host}` === origin;
      } catch {
        return a === origin;
      }
    });
    if (!matched) {
      return {
        ok: false,
        code: "url_rejected",
        message: `Origin ${origin} not in allowed_origins`,
      };
    }
  }

  return { ok: true, url, origin };
}
