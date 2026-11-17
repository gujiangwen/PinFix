export type LocationMethod =
  | "fiber_debug_source"
  | "vue_file"
  | "source_map"
  | "vite_module_graph"
  | "selector_memory"
  | "component_heuristic"
  | "human"
  | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export type SourceLocation = {
  file: string;
  line?: number | null;
  column?: number | null;
  confidence: number;
  confidence_level: ConfidenceLevel;
  method: LocationMethod;
  alternates?: Array<{
    file: string;
    confidence: number;
    method?: LocationMethod;
  }>;
};

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

export function normalizeRepoRelative(file: string): string {
  let f = file.replace(/\\/g, "/");
  // Strip webpack/vite absolute prefixes commonly seen in debugSource.
  const markers = ["/src/", "/apps/", "/packages/"];
  for (const m of markers) {
    const idx = f.lastIndexOf(m);
    if (idx >= 0) {
      f = f.slice(idx + 1);
      break;
    }
  }
  if (f.startsWith("file://")) f = f.replace(/^file:\/\//, "");
  return f.replace(/^\//, "");
}

export function locationFromDebugSource(input: {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
}): SourceLocation {
  const file = normalizeRepoRelative(input.fileName);
  const confidence = 0.92;
  return {
    file,
    line: input.lineNumber ?? null,
    column: input.columnNumber ?? null,
    confidence,
    confidence_level: confidenceLevel(confidence),
    method: "fiber_debug_source",
  };
}

export function locationFromVueFile(file: string): SourceLocation {
  const confidence = 0.88;
  return {
    file: normalizeRepoRelative(file),
    line: null,
    column: null,
    confidence,
    confidence_level: confidenceLevel(confidence),
    method: "vue_file",
  };
}

export function locationFromHeuristic(input: {
  componentName?: string | null;
  selector?: string | null;
}): SourceLocation | null {
  const name = input.componentName?.trim();
  if (!name || name === "Anonymous") return null;
  // Guess common React/Vite paths from component display name.
  const base = name.replace(/[^A-Za-z0-9_-]/g, "");
  if (!base) return null;
  const file = `src/components/${base}.tsx`;
  const confidence = 0.32;
  return {
    file,
    line: null,
    column: null,
    confidence,
    confidence_level: confidenceLevel(confidence),
    method: "component_heuristic",
    alternates: [
      { file: `src/${base}.tsx`, confidence: 0.28, method: "component_heuristic" },
      {
        file: `src/pages/${base}.tsx`,
        confidence: 0.25,
        method: "component_heuristic",
      },
    ],
  };
}

/** Stable structural fingerprint (no text / values). */
export function domFingerprint(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 5) {
    const tag = node.tagName.toLowerCase();
    const testid =
      node.getAttribute("data-testid") ??
      node.getAttribute("data-test-id") ??
      "";
    const cls = Array.from(node.classList)
      .filter((c) => c.length < 40)
      .slice(0, 3)
      .join(".");
    parts.push(`${tag}${testid ? `[testid=${testid}]` : ""}${cls ? `.${cls}` : ""}`);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(">");
}

export function attachLocationToSniff(
  sniff: Record<string, unknown>,
  el?: Element | null,
): Record<string, unknown> {
  const existing = sniff.location as SourceLocation | undefined;
  if (existing?.file) return sniff;

  let location: SourceLocation | null = null;

  const debug = sniff.debugSource as
    | { fileName?: string; lineNumber?: number; columnNumber?: number }
    | undefined;
  if (debug?.fileName) {
    location = locationFromDebugSource({
      fileName: debug.fileName,
      lineNumber: debug.lineNumber,
      columnNumber: debug.columnNumber,
    });
  }

  if (!location && sniff.framework === "vue3") {
    const stack = sniff.componentStack as Array<{ file?: string; name?: string }>;
    const withFile = stack?.find((f) => f.file);
    if (withFile?.file) location = locationFromVueFile(withFile.file);
  }

  if (!location) {
    const stack = sniff.componentStack as Array<{ name?: string }> | undefined;
    location = locationFromHeuristic({
      componentName: stack?.[0]?.name,
      selector: typeof sniff.selector === "string" ? sniff.selector : null,
    });
  }

  if (!location) {
    // Production / DOM-only: still surface a low-confidence placeholder.
    location = {
      file: "src/unknown",
      line: null,
      column: null,
      confidence: 0.12,
      confidence_level: "low",
      method: "unknown",
    };
  }

  const out: Record<string, unknown> = { ...sniff };
  out.location = location;
  if (el) out.fingerprint = domFingerprint(el);
  return out;
}
