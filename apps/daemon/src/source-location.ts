import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Project, SourceLocation } from "@sightloop/shared";
import {
  bumpLocationHintHit,
  findLocationHint,
  type Database,
} from "@sightloop/db";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".next",
]);

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "‹GLOBSTAR›")
    .replace(/\*\*/g, "‹GLOBSTAR›")
    .replace(/\*/g, "[^/]*")
    .replace(/‹GLOBSTAR›/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function pathAllowed(
  relPath: string,
  whitelist: string[],
): boolean {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!whitelist.length) return true;
  return whitelist.some((g) => globToRegExp(g).test(norm));
}

export function searchProjectFiles(
  project: Project,
  query: string,
  limit = 30,
): string[] {
  const root = project.repo_path;
  const q = query.trim().toLowerCase();
  const hits: string[] = [];

  function walk(dir: string): void {
    if (hits.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (hits.length >= limit) return;
      if (ent.name.startsWith(".") && ent.name !== ".env.example") {
        if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
        if (ent.isDirectory() && ent.name !== ".") continue;
      }
      if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(root, full).replace(/\\/g, "/");
      if (!pathAllowed(rel, project.file_whitelist)) continue;
      if (q && !rel.toLowerCase().includes(q) && !ent.name.toLowerCase().includes(q)) {
        continue;
      }
      hits.push(rel);
    }
  }

  walk(root);
  return hits;
}

export function assertFileInProject(
  project: Project,
  filePath: string,
): { ok: true; rel: string } | { ok: false; message: string } {
  const rel = filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
  if (rel.includes("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
    return { ok: false, message: "Path escapes project root" };
  }
  const abs = resolve(project.repo_path, rel);
  const root = resolve(project.repo_path);
  if (abs !== root && !abs.startsWith(root + sep)) {
    return { ok: false, message: "Path escapes project root" };
  }
  if (!pathAllowed(rel, project.file_whitelist)) {
    return { ok: false, message: "Path not in file_whitelist" };
  }
  return { ok: true, rel };
}

function confidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= 0.8) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function locationFromHint(
  file: string,
  line: number | null | undefined,
  confidence: number,
  method: SourceLocation["method"],
): SourceLocation {
  return {
    file,
    line: line ?? null,
    column: null,
    confidence,
    confidence_level: confidenceLevel(confidence),
    method,
  };
}

/** Best-effort: read local .map under repo and pick a source matching component. */
export function locateFromLocalMaps(
  project: Project,
  componentName?: string | null,
): SourceLocation | null {
  const mapRootCandidates = [
    join(project.repo_path, "dist"),
    join(project.repo_path, "build"),
    join(project.repo_path, ".sightloop-maps"),
    project.repo_path,
  ];
  const sources: string[] = [];
  for (const root of mapRootCandidates) {
    if (!existsSync(root)) continue;
    collectMapSources(root, sources, 40);
    if (sources.length) break;
  }
  if (!sources.length) return null;
  const name = (componentName ?? "").replace(/[^A-Za-z0-9]/g, "");
  const hit = name
    ? sources.find((s) => s.toLowerCase().includes(name.toLowerCase()))
    : sources.find((s) => s.includes("/src/"));
  const file = (hit ?? sources[0]!)
    .replace(/\\/g, "/")
    .replace(/^webpack:\/\/\//, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
  const conf = hit && name ? 0.58 : 0.42;
  return locationFromHint(file, null, conf, "source_map");
}

function collectMapSources(dir: string, out: string[], budget: number): void {
  if (out.length >= budget) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= budget) return;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      collectMapSources(join(dir, ent.name), out, budget);
      continue;
    }
    if (!ent.name.endsWith(".map")) continue;
    try {
      const st = statSync(join(dir, ent.name));
      if (st.size > 2_000_000) continue;
      const raw = readFileSync(join(dir, ent.name), "utf8");
      const parsed = JSON.parse(raw) as { sources?: unknown };
      if (Array.isArray(parsed.sources)) {
        for (const s of parsed.sources) {
          if (typeof s === "string") out.push(s);
        }
      }
    } catch {
      // ignore bad maps
    }
  }
}

/** Silent Vite ping + optional module graph heuristic. */
export async function locateFromVite(
  project: Project,
  componentName?: string | null,
): Promise<SourceLocation | null> {
  const origin = project.dev_server_origin?.replace(/\/$/, "");
  if (!origin) return null;
  try {
    const ping = await fetch(`${origin}/__vite_ping`, {
      signal: AbortSignal.timeout(800),
    });
    if (!ping.ok && ping.status !== 404) {
      // Some Vite versions have no __vite_ping — try root.
      await fetch(`${origin}/`, { signal: AbortSignal.timeout(800) });
    }
  } catch {
    return null;
  }

  const name = (componentName ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!name) return null;
  // Heuristic: common Vite src paths when server is up.
  const candidates = [
    `src/components/${name}.tsx`,
    `src/components/${name}.jsx`,
    `src/${name}.tsx`,
    `src/pages/${name}.tsx`,
  ];
  for (const c of candidates) {
    const abs = join(project.repo_path, c);
    if (existsSync(abs) && pathAllowed(c, project.file_whitelist)) {
      return locationFromHint(c, null, 0.55, "vite_module_graph");
    }
  }
  return null;
}

export async function locateSource(
  db: Database,
  project: Project,
  input: {
    selector?: string;
    fingerprint?: string;
    component_name?: string;
    source_mapping_urls?: string[];
  },
): Promise<{ location: SourceLocation | null; hint_id?: string }> {
  // 1) Memory / human hints
  const hint = findLocationHint(db, project.id, {
    selector: input.selector,
    fingerprint: input.fingerprint,
  });
  if (hint) {
    bumpLocationHintHit(db, hint.id);
    const method =
      hint.source === "human" ? ("human" as const) : ("selector_memory" as const);
    const conf =
      hint.source === "human"
        ? Math.max(hint.confidence, 0.95)
        : Math.min(0.85, Math.max(hint.confidence, 0.7));
    return {
      location: locationFromHint(hint.file_path, hint.line, conf, method),
      hint_id: hint.id,
    };
  }

  // 2) Inline data: URLs from page (only data: inline — no remote fetch)
  if (input.source_mapping_urls?.length) {
    for (const url of input.source_mapping_urls) {
      if (!url.startsWith("data:")) continue;
      try {
        const comma = url.indexOf(",");
        if (comma < 0) continue;
        const header = url.slice(0, comma);
        const payload = url.slice(comma + 1);
        const jsonText = header.includes(";base64")
          ? Buffer.from(payload, "base64").toString("utf8")
          : decodeURIComponent(payload);
        const parsed = JSON.parse(jsonText) as { sources?: unknown };
        const sources = Array.isArray(parsed.sources)
          ? parsed.sources.filter((s): s is string => typeof s === "string")
          : [];
        const name = input.component_name ?? "";
        const hit = sources.find((s) =>
          s.toLowerCase().includes(name.toLowerCase()),
        );
        if (hit || sources[0]) {
          const file = (hit ?? sources[0]!)
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/^\//, "");
          return {
            location: locationFromHint(
              file,
              null,
              hit ? 0.6 : 0.45,
              "source_map",
            ),
          };
        }
      } catch {
        // continue
      }
    }
  }

  // 3) Local .map files in repo
  const fromMaps = locateFromLocalMaps(project, input.component_name);
  if (fromMaps) return { location: fromMaps };

  // 4) Vite collaboration
  const fromVite = await locateFromVite(project, input.component_name);
  if (fromVite) return { location: fromVite };

  // 5) Weak heuristic from component name + repo search
  if (input.component_name) {
    const files = searchProjectFiles(project, input.component_name, 5);
    if (files[0]) {
      return {
        location: locationFromHint(files[0], null, 0.35, "component_heuristic"),
      };
    }
  }

  return { location: null };
}
