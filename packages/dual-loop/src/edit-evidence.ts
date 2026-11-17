import {
  RefineIRSchema,
  type PlanIR,
  type RefineIR,
} from "@sightloop/shared";
import { filterPlanFilesByProject } from "./whitelist.js";

export type EditEvidenceRef = {
  kind:
    | "sniff"
    | "stack"
    | "refine_issue"
    | "strategy"
    | "scenario_assert"
    | "manual"
    | "plan_file";
  id: string;
  note?: string;
};

export type EditEvidence = {
  hunk_id: string;
  files: string[];
  evidence_refs: EditEvidenceRef[];
  /** R2: adjacent minor hunks may share evidence via merge. */
  merged_from?: string[];
};

export type DiffHunk = {
  hunk_id: string;
  file: string;
  header: string;
};

/** Parse unified diff into file hunks (@@ blocks). */
export function parseDiffHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentFile = "";
  let idx = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      currentFile = line.replace(/^\+\+\+ (b\/)?/, "").trim();
      continue;
    }
    if (line.startsWith("@@")) {
      idx += 1;
      hunks.push({
        hunk_id: `hunk:${currentFile || "unknown"}:${idx}`,
        file: currentFile || "unknown",
        header: line.slice(0, 120),
      });
    }
  }
  if (!hunks.length && patch.trim()) {
    hunks.push({
      hunk_id: "hunk:patch:1",
      file: "unknown",
      header: "@@ synthetic @@",
    });
  }
  return hunks;
}

/** R2: merge adjacent same-file hunks into one evidence unit. */
export function mergeAdjacentHunks(hunks: DiffHunk[]): DiffHunk[] {
  if (hunks.length <= 1) return hunks;
  const out: DiffHunk[] = [];
  let cur = { ...hunks[0]!, merged: [hunks[0]!.hunk_id] as string[] };
  for (let i = 1; i < hunks.length; i++) {
    const h = hunks[i]!;
    if (h.file === cur.file) {
      cur.merged.push(h.hunk_id);
      cur.hunk_id = `hunk:${cur.file}:merged:${cur.merged.length}`;
      cur.header = `${cur.header} + ${h.header}`;
    } else {
      out.push({
        hunk_id: cur.hunk_id,
        file: cur.file,
        header: cur.header,
      });
      cur = { ...h, merged: [h.hunk_id] };
    }
  }
  out.push({ hunk_id: cur.hunk_id, file: cur.file, header: cur.header });
  return out;
}

export function autoBindEditEvidence(opts: {
  patch: string;
  files_touched?: string[];
  plan?: PlanIR | null;
  refine_ir?: RefineIR | null;
  sniff_selector?: string | null;
  strategy_ids?: string[];
  /** R7 */
  project_whitelist?: string[];
  /** When true, refuse to auto-bind (negative smoke). */
  forbid_auto?: boolean;
  /** R2: merge adjacent same-file hunks (default true). */
  merge_adjacent?: boolean;
}):
  | { ok: true; evidence: EditEvidence[] }
  | { ok: false; missing: string[]; evidence: EditEvidence[] } {
  let hunks = parseDiffHunks(opts.patch);
  if (opts.merge_adjacent !== false) {
    hunks = mergeAdjacentHunks(hunks);
  }
  const effective =
    hunks.length > 0
      ? hunks
      : (opts.files_touched ?? opts.plan?.allowed_files ?? []).map((f, i) => ({
          hunk_id: `hunk:${f}:${i + 1}`,
          file: f,
          header: "@@ file @@",
        }));

  if (!effective.length) {
    return { ok: true, evidence: [] };
  }

  if (opts.forbid_auto) {
    return {
      ok: false,
      missing: effective.map((h) => h.hunk_id),
      evidence: effective.map((h) => ({
        hunk_id: h.hunk_id,
        files: [h.file],
        evidence_refs: [],
      })),
    };
  }

  const baseRefs: EditEvidenceRef[] = [];
  if (opts.sniff_selector) {
    baseRefs.push({
      kind: "sniff",
      id: `sniff:${opts.sniff_selector.slice(0, 80)}`,
      note: "annotation/sniff selector",
    });
  }
  for (const issue of opts.refine_ir?.blocking_issues ?? []) {
    baseRefs.push({
      kind: "refine_issue",
      id: issue.id,
      note: issue.summary.slice(0, 120),
    });
  }
  for (const sid of opts.strategy_ids ?? []) {
    baseRefs.push({ kind: "strategy", id: sid });
  }

  // R7: plan_file evidence ids must ∩ whitelist
  let planFiles = opts.plan?.allowed_files ?? [];
  if (opts.project_whitelist?.length) {
    const { kept, dropped } = {
      kept: filterPlanFilesByProject(planFiles, opts.project_whitelist),
      dropped: [] as string[],
    };
    const keptSet = new Set(kept);
    for (const f of planFiles) {
      if (!keptSet.has(f)) dropped.push(f);
    }
    planFiles = kept;
  }
  for (const f of planFiles) {
    baseRefs.push({ kind: "plan_file", id: f, note: "plan allowed_files" });
  }
  if (!baseRefs.length) {
    baseRefs.push({
      kind: "manual",
      id: "mock:default",
      note: "mock auto-bind default evidence",
    });
  }

  const evidence: EditEvidence[] = effective.map((h) => {
    const fileRefs = baseRefs.filter(
      (r) =>
        r.kind !== "plan_file" ||
        r.id === h.file ||
        planFiles.includes(h.file),
    );
    const refs = fileRefs.length ? fileRefs : baseRefs.slice(0, 1);
    return {
      hunk_id: h.hunk_id,
      files: [h.file],
      evidence_refs: refs.slice(0, 8),
    };
  });

  const missing = evidence
    .filter((e) => !e.evidence_refs.length)
    .map((e) => e.hunk_id);
  if (missing.length) return { ok: false, missing, evidence };
  return { ok: true, evidence };
}

export function refineFromEditWithoutEvidence(opts: {
  session_id: string;
  missing_hunks: string[];
  plan_id?: string;
}): RefineIR {
  return RefineIRSchema.parse({
    version: 1,
    source: "implementer_blocked",
    session_id: opts.session_id,
    plan_id: opts.plan_id,
    blocking_issues: opts.missing_hunks.slice(0, 20).map((id) => ({
      id: `edit_without_evidence:${id}`,
      severity: "blocker" as const,
      summary: `Edit hunk ${id} lacks evidence binding`,
      evidence: {
        kind: "diff" as const,
        excerpt: `edit_without_evidence:${id}`,
      },
    })),
    notes: "M12b/R2: every write hunk must bind sniff/refine/strategy/plan evidence",
    created_at: Date.now(),
  });
}
