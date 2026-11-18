/**
 * Lightweight sourceMappingURL helpers (no full VLQ consumer).
 * Used to surface candidate source files for medium-confidence locate.
 */

export type SourceMapMeta = {
  url: string;
  inline: boolean;
  sources: string[];
};

const SOURCEMAP_RE = /[#@]\s*sourceMappingURL\s*=\s*(\S+)/;

export function extractSourceMappingUrl(scriptText: string): string | null {
  const m = SOURCEMAP_RE.exec(scriptText);
  return m?.[1] ?? null;
}

function decodeBase64Utf8(payload: string): string {
  const NodeBuffer = (
    globalThis as unknown as {
      Buffer?: {
        from(data: string, encoding: string): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  if (NodeBuffer) {
    return NodeBuffer.from(payload, "base64").toString("utf8");
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export function parseInlineSourceMap(dataUrl: string): SourceMapMeta | null {
  if (!dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    const jsonText = header.includes(";base64")
      ? decodeBase64Utf8(payload)
      : decodeURIComponent(payload);
    const parsed = JSON.parse(jsonText) as { sources?: unknown };
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter((s): s is string => typeof s === "string")
      : [];
    return { url: dataUrl.slice(0, 32) + "…", inline: true, sources };
  } catch {
    return null;
  }
}

export function collectPageSourceMappingUrls(doc: Document = document): string[] {
  const urls: string[] = [];
  const scripts = doc.querySelectorAll("script");
  for (const s of Array.from(scripts)) {
    const src = s.getAttribute("src");
    if (src && src.includes(".map")) urls.push(src);
    const text = s.textContent ?? "";
    const mapped = extractSourceMappingUrl(text);
    if (mapped) urls.push(mapped);
  }
  return [...new Set(urls)].slice(0, 20);
}

/** Pick the best-looking source path for a component name from map sources[]. */
export function pickSourceForComponent(
  sources: string[],
  componentName?: string | null,
): { file: string; confidence: number } | null {
  if (!sources.length) return null;
  const name = (componentName ?? "").replace(/[^A-Za-z0-9]/g, "");
  const normalized = sources.map((s) =>
    s.replace(/\\/g, "/").replace(/^webpack:\/\/\//, "").replace(/^\.\//, ""),
  );
  if (name) {
    const hit = normalized.find((s) =>
      s.toLowerCase().includes(name.toLowerCase()),
    );
    if (hit) return { file: hit.replace(/^\//, ""), confidence: 0.62 };
  }
  const srcish = normalized.find((s) => s.includes("/src/"));
  if (srcish) return { file: srcish.replace(/^\//, ""), confidence: 0.48 };
  return {
    file: normalized[0]!.replace(/^\//, ""),
    confidence: 0.4,
  };
}
