import type { Database } from "@sightloop/db";
import {
  getKnowledge,
  getLatestAcceptanceRun,
  getProject,
  getSession,
  getSessionAgentReview,
  getSessionPlan,
  listAgentSteps,
  listReviews,
  queryKnowledge,
} from "@sightloop/db";
import { diffPatch } from "@sightloop/agent-runtime";
import type {
  DiffSummary,
  DistilledKnowledgePreview,
  PlanIR,
  RecallHit,
  ReviewIR,
  TimelineEvent,
  VerifyResult,
} from "@sightloop/shared";

export function summarizePatch(patch: string): DiffSummary {
  const files: DiffSummary["files"] = [];
  let additions = 0;
  let deletions = 0;
  let current: { path: string; additions: number; deletions: number } | null =
    null;

  const flush = () => {
    if (current) {
      files.push(current);
      current = null;
    }
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      const m = /diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const path = m?.[2] ?? m?.[1] ?? "unknown";
      current = { path, additions: 0, deletions: 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      current.additions += 1;
      additions += 1;
    } else if (line.startsWith("-")) {
      current.deletions += 1;
      deletions += 1;
    }
  }
  flush();

  const truncated = files.length > 40;
  return {
    files: truncated ? files.slice(0, 40) : files,
    additions,
    deletions,
    truncated,
  };
}

function previewMd(body: string, n = 180): string {
  return body.replace(/\s+/g, " ").trim().slice(0, n);
}

export function extractRecallHits(
  steps: ReturnType<typeof listAgentSteps>,
): RecallHit[] {
  const step = [...steps]
    .reverse()
    .find((s) => s.tool_name === "list_knowledge");
  if (!step?.output || typeof step.output !== "object") return [];
  const hits = (step.output as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  return hits.map((h) => {
    const hit = h as {
      id?: string | null;
      title?: string;
      score?: number | null;
      distance?: number | null;
      retrieve?: string | null;
      kind?: string | null;
    };
    return {
      knowledge_id: hit.id ?? null,
      title: hit.title ?? "(untitled)",
      score: hit.score ?? null,
      distance: hit.distance ?? null,
      retrieve: hit.retrieve ?? null,
      kind: hit.kind ?? null,
    };
  });
}

export function extractVerify(
  steps: ReturnType<typeof listAgentSteps>,
  verifyCmd: string | null,
): VerifyResult | null {
  const step = [...steps].reverse().find((s) => s.phase === "verify");
  if (!step) return null;
  const out =
    step.output && typeof step.output === "object"
      ? (step.output as { ok?: boolean; output?: string })
      : {};
  return {
    ok: Boolean(out.ok) && !step.error,
    exit_code: out.ok ? 0 : 1,
    log_tail: String(out.output ?? step.error ?? "").slice(-2000),
    command: verifyCmd,
  };
}

export function buildTimeline(
  steps: ReturnType<typeof listAgentSteps>,
  reviews: ReturnType<typeof listReviews>,
  sessionStatus: string,
  sessionUpdatedAt: number,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const s of steps) {
    events.push({
      at: s.created_at,
      kind: s.phase === "verify" ? "verify" : "step",
      label: `${s.phase}${s.tool_name ? ` · ${s.tool_name}` : ""}`,
      detail: s.summary ?? s.error ?? null,
      phase: s.phase,
      tool_name: s.tool_name,
      idx: s.idx,
    });
    if (s.tool_name === "list_knowledge") {
      const hits = extractRecallHits([s]);
      events.push({
        at: s.created_at + 1,
        kind: "recall",
        label: `recall · ${hits.length} hit(s)`,
        detail: hits.map((h) => h.title).join(", ") || null,
      });
    }
  }

  for (const r of reviews) {
    events.push({
      at: r.created_at,
      kind: r.decision === "refine" ? "refine_note" : "review",
      label: `review · ${r.decision}`,
      detail: r.note,
    });
  }

  events.push({
    at: sessionUpdatedAt,
    kind: "status",
    label: `status · ${sessionStatus}`,
    detail: null,
  });

  return events.sort((a, b) => a.at - b.at || (a.idx ?? 0) - (b.idx ?? 0));
}

export function buildSessionReadModel(
  db: Database,
  sessionId: string,
): {
  session: NonNullable<ReturnType<typeof getSession>>;
  steps: ReturnType<typeof listAgentSteps>;
  reviews: ReturnType<typeof listReviews>;
  timeline: TimelineEvent[];
  verify: VerifyResult | null;
  recall_hits: RecallHit[];
  diff_summary: DiffSummary | null;
  latest_knowledge: DistilledKnowledgePreview | null;
  acceptance_gate: ReturnType<typeof getLatestAcceptanceRun> | null;
  plan: PlanIR | null;
  agent_review: ReviewIR | null;
  patch: string;
} | null {
  const session = getSession(db, sessionId);
  if (!session) return null;
  const project = getProject(db, session.project_id);
  const steps = listAgentSteps(db, sessionId);
  const reviews = listReviews(db, sessionId);
  const acceptance_gate = getLatestAcceptanceRun(db, sessionId) ?? null;
  const patch = project
    ? diffPatch(
        project.repo_path,
        session.git_base_sha,
        session.temp_commit_sha,
      )
    : "";

  const recall_hits = extractRecallHits(steps).map((h) => {
    if (!h.knowledge_id) return h;
    const k = getKnowledge(db, h.knowledge_id);
    return {
      ...h,
      body_preview: k ? previewMd(k.body_md) : undefined,
      kind: h.kind ?? k?.kind ?? null,
    };
  });

  let latest_knowledge: DistilledKnowledgePreview | null = null;
  const distilled = queryKnowledge(db, {
    project_id: session.project_id,
    include_archived: false,
    limit: 20,
  }).find((k) => k.session_id === sessionId);
  if (distilled) {
    latest_knowledge = {
      id: distilled.id,
      title: distilled.title,
      kind: distilled.kind,
      body_preview: previewMd(distilled.body_md, 220),
    };
  }

  return {
    session,
    steps,
    reviews,
    timeline: buildTimeline(
      steps,
      reviews,
      session.status,
      session.updated_at,
    ),
    verify: extractVerify(steps, project?.verify_cmd ?? null),
    recall_hits,
    diff_summary: patch ? summarizePatch(patch) : null,
    latest_knowledge,
    acceptance_gate,
    plan: getSessionPlan(db, sessionId),
    agent_review: getSessionAgentReview(db, sessionId),
    patch,
  };
}
