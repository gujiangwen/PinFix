/**
 * M12a — trajectory strategy memory (rule distill + text retrieve).
 * R1: Accept-only distill (caller); Top-K=3 + SIGHTLOOP_STRATEGY_MIN_SCORE.
 * R7: allowed_files_hints ∩ project whitelist.
 */

import { filterPlanFilesByProject } from "./whitelist.js";

export type StrategyCard = {
  pattern_id: string;
  symptoms: string[];
  successful_resolutions: string[];
  failed_approaches: string[];
  related_issue_kinds: string[];
  allowed_files_hints: string[];
  session_id?: string;
  acceptance_paths?: string[];
  summary: string;
};

export type StrategyHit = {
  title: string;
  path: string;
  pattern_id: string;
  score: number;
  summary?: string;
  allowed_files_hints?: string[];
};

export const DEFAULT_STRATEGY_TOP_K = 3;
export const DEFAULT_STRATEGY_MIN_SCORE = 1;

export function strategyMinScore(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SIGHTLOOP_STRATEGY_MIN_SCORE;
  if (raw === undefined || raw === "") return DEFAULT_STRATEGY_MIN_SCORE;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? Math.max(0, n) : DEFAULT_STRATEGY_MIN_SCORE;
}

/** R7: drop out-of-whitelist file hints. */
export function intersectStrategyHintsWithWhitelist(
  hints: string[],
  projectWhitelist: string[],
): { kept: string[]; dropped: string[] } {
  const kept = filterPlanFilesByProject(hints, projectWhitelist);
  const keptSet = new Set(kept);
  const dropped = hints.filter((h) => !keptSet.has(h));
  return { kept, dropped };
}

export function distillStrategyCard(input: {
  session_id: string;
  annotation_note?: string | null;
  selector?: string | null;
  root_cause?: string | null;
  issue_summaries?: string[];
  resolutions?: Array<{ issue_id: string; status: string; rationale?: string }>;
  files_touched?: string[];
  failed_notes?: string[];
  /** R7 */
  project_whitelist?: string[];
}): StrategyCard {
  const symptoms = [
    input.annotation_note,
    input.selector ? `selector:${input.selector}` : null,
    input.root_cause,
    ...(input.issue_summaries ?? []),
  ]
    .filter((s): s is string => Boolean(s && String(s).trim()))
    .map((s) => s.slice(0, 200))
    .slice(0, 12);

  const successful_resolutions = (input.resolutions ?? [])
    .filter((r) => r.status === "addressed")
    .map((r) => `${r.issue_id}: ${(r.rationale ?? "addressed").slice(0, 160)}`)
    .slice(0, 12);

  const failed_approaches = (input.failed_notes ?? [])
    .map((n) => n.slice(0, 200))
    .slice(0, 8);

  const related_issue_kinds = [
    ...new Set(
      (input.resolutions ?? []).map((r) => r.issue_id.split(":")[0] ?? "other"),
    ),
  ].slice(0, 8);

  let allowed_files_hints = (input.files_touched ?? []).slice(0, 8);
  if (input.project_whitelist?.length) {
    allowed_files_hints = intersectStrategyHintsWithWhitelist(
      allowed_files_hints,
      input.project_whitelist,
    ).kept;
  }

  const pattern_id = `strat-${input.session_id.slice(0, 10)}`;
  const summary =
    symptoms[0]?.slice(0, 120) ??
    `Strategy from session ${input.session_id.slice(0, 8)}`;

  return {
    pattern_id,
    symptoms: symptoms.length ? symptoms : ["accepted fix"],
    successful_resolutions: successful_resolutions.length
      ? successful_resolutions
      : ["human accept after dual-loop pass"],
    failed_approaches,
    related_issue_kinds,
    allowed_files_hints,
    session_id: input.session_id,
    summary,
  };
}

export function strategyCardToMarkdown(card: StrategyCard): string {
  return `# Strategy: ${card.pattern_id}

${card.summary}

## Symptoms
${card.symptoms.map((s) => `- ${s}`).join("\n")}

## Successful resolutions
${card.successful_resolutions.map((s) => `- ${s}`).join("\n")}

## Failed approaches
${
  card.failed_approaches.length
    ? card.failed_approaches.map((s) => `- ${s}`).join("\n")
    : "- (none recorded)"
}

## Related issue kinds
${card.related_issue_kinds.map((s) => `- ${s}`).join("\n") || "- (n/a)"}

## Allowed files hints
${card.allowed_files_hints.map((s) => `- \`${s}\``).join("\n") || "- (n/a)"}

<!-- sightloop:strategy pattern_id=${card.pattern_id} session=${card.session_id ?? ""} -->
`;
}

export function strategyTitle(card: StrategyCard): string {
  return `Strategy · ${card.pattern_id}: ${card.summary.slice(0, 60)}`;
}

/**
 * Rank strategy cards by text overlap.
 * R1: Top-K (default 3) + min score threshold — below threshold not injected.
 */
export function retrieveStrategyHits(
  cards: Array<{
    id?: string;
    title: string;
    body_md: string;
    tags?: string[];
  }>,
  query: {
    note?: string | null;
    selector?: string | null;
    root_cause?: string | null;
  },
  opts?: {
    topK?: number;
    minScore?: number;
    project_whitelist?: string[];
  },
): StrategyHit[] {
  const topK = opts?.topK ?? DEFAULT_STRATEGY_TOP_K;
  const minScore = opts?.minScore ?? strategyMinScore();
  const strategyCards = cards.filter(
    (c) =>
      (c.tags ?? []).includes("strategy") ||
      c.body_md.includes("sightloop:strategy") ||
      c.title.toLowerCase().includes("strategy"),
  );
  const q = [query.note ?? "", query.selector ?? "", query.root_cause ?? ""]
    .join(" ")
    .toLowerCase();
  const tokens = q.split(/[^a-z0-9_/.:-]+/).filter((t) => t.length > 2);

  const hits: StrategyHit[] = [];
  for (const c of strategyCards) {
    const blob = `${c.title}\n${c.body_md}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (blob.includes(t)) score += 1;
    }
    if (!tokens.length) score = 0.1;
    if (score < minScore) continue; // R1 threshold
    const m = c.body_md.match(/pattern_id=([^\s-->]+)/);
    const hintLines = [...c.body_md.matchAll(/`([^`]+)`/g)].map((x) => x[1]!);
    let hints = hintLines.filter((h) => h.includes("/") || h.includes("."));
    if (opts?.project_whitelist?.length) {
      hints = intersectStrategyHintsWithWhitelist(
        hints,
        opts.project_whitelist,
      ).kept;
    }
    hits.push({
      title: c.title,
      path: c.id ? `knowledge:${c.id}` : `strategy:${c.title}`,
      pattern_id: m?.[1] ?? c.title,
      score,
      summary: c.body_md
        .split("\n")
        .find((l) => l.trim() && !l.startsWith("#"))
        ?.slice(0, 160),
      allowed_files_hints: hints.slice(0, 8),
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}
