import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type AcceptanceHit = {
  title: string;
  path: string;
  fingerprint?: string;
  score: number;
  summary?: string;
};

/**
 * Lightweight text similarity over <repo>/acceptance/scenarios/*.json (M11c).
 * No writes — read-only for Planner context.
 */
export function retrieveAcceptanceHits(
  repoPath: string,
  query: {
    note?: string | null;
    selector?: string | null;
    root_cause?: string | null;
  },
  topK = 3,
): AcceptanceHit[] {
  const scenariosDir = join(repoPath, "acceptance", "scenarios");
  if (!existsSync(scenariosDir)) return [];

  const q = [
    query.note ?? "",
    query.selector ?? "",
    query.root_cause ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const tokens = q.split(/[^a-z0-9_/.-]+/).filter((t) => t.length > 2);

  const hits: AcceptanceHit[] = [];
  for (const name of readdirSync(scenariosDir)) {
    if (!name.endsWith(".json")) continue;
    const rel = `acceptance/scenarios/${name}`;
    const abs = join(scenariosDir, name);
    try {
      const raw = JSON.parse(readFileSync(abs, "utf8")) as {
        fingerprint?: string;
        start_url?: string;
        scenario?: { start_url?: string; steps?: unknown[] };
        session_id?: string;
      };
      const blob = JSON.stringify(raw).toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (blob.includes(t)) score += 1;
      }
      if (!tokens.length) score = 0.1;
      if (score <= 0) continue;
      hits.push({
        title: raw.fingerprint ?? name.replace(/\.json$/, ""),
        path: rel,
        fingerprint: raw.fingerprint,
        score,
        summary: `start=${raw.start_url ?? raw.scenario?.start_url ?? "?"} steps=${
          Array.isArray(raw.scenario?.steps) ? raw.scenario!.steps!.length : "?"
        }`,
      });
    } catch {
      // skip corrupt
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}
