import { resolve } from "node:path";
import type { Database } from "@sightloop/db";
import {
  getProject,
  getSession,
  updateSession,
  insertAgentStep,
  insertReview,
  insertKnowledge,
  insertAudit,
  matchKnowledgeForRetrieve,
  listAgentSteps,
  countActiveSessionsForProject,
} from "@sightloop/db";
import {
  createMarkupTools,
  writeAnnotationWorkspace,
} from "@sightloop/markup-bridge";
import {
  runAgentLoop,
  buildAcceptDistill,
  acceptSessionGit,
  revertSessionGit,
  selectAgentRunner,
  diffPatch,
  type LoopHooks,
} from "@sightloop/agent-runtime";
import type { ReviewDecision, Session } from "@sightloop/shared";
import type { SessionWsHub } from "./ws-hub.js";
import type { DaemonConfig } from "./config.js";
import { buildSessionReadModel } from "./session-read-model.js";

const running = new Set<string>();

function extractComponentNames(sniff: unknown): string[] {
  if (!sniff || typeof sniff !== "object") return [];
  const stack = (sniff as { componentStack?: unknown }).componentStack;
  if (!Array.isArray(stack)) return [];
  return stack
    .map((c) =>
      c && typeof c === "object" && "name" in c
        ? String((c as { name: unknown }).name)
        : null,
    )
    .filter((n): n is string => Boolean(n));
}

function inferStack(sniff: unknown): string | null {
  if (!sniff || typeof sniff !== "object") return null;
  const fw = (sniff as { framework?: unknown }).framework;
  return typeof fw === "string" && fw.trim() ? fw.trim() : null;
}

function defaultMarkupWorkspace(
  cfg: DaemonConfig,
  projectId: string,
  configured: string | null,
): string {
  if (configured) return resolve(configured);
  return resolve(
    cfg.markupWorkspaceRoot,
    projectId,
  );
}

function makeHooks(
  hub: SessionWsHub,
  db: Database,
  sessionId: string,
  projectId: string,
): LoopHooks {
  return {
    onStatus(status, stepCount) {
      updateSession(db, sessionId, { status, step_count: stepCount });
      hub.broadcastStatus(sessionId, status, stepCount);
    },
    onStep(step) {
      insertAgentStep(db, {
        session_id: sessionId,
        idx: step.idx,
        phase: step.phase,
        tool_name: step.tool_name ?? null,
        input: step.input,
        output: step.output,
        error: step.error,
        summary: step.summary ?? null,
        duration_ms: step.duration_ms ?? null,
        tokens_in: step.tokens_in ?? null,
        tokens_out: step.tokens_out ?? null,
      });
      hub.broadcastStep(sessionId, {
        idx: step.idx,
        phase: step.phase,
        tool_name: step.tool_name,
        summary: step.summary,
      });
      hub.broadcastTimeline(sessionId, {
        at: Date.now(),
        kind: step.phase === "verify" ? "verify" : "step",
        label: `${step.phase}${step.tool_name ? ` · ${step.tool_name}` : ""}`,
        detail: step.summary ?? step.error ?? null,
      });

      if (step.tool_name === "list_knowledge" && step.output) {
        const hitsRaw =
          typeof step.output === "object" &&
          step.output &&
          "hits" in step.output &&
          Array.isArray((step.output as { hits: unknown }).hits)
            ? ((step.output as { hits: Array<Record<string, unknown>> }).hits)
            : [];
        const hits = hitsRaw.map((h) => ({
          knowledge_id: (h.id as string | null | undefined) ?? null,
          title: String(h.title ?? "(untitled)"),
          score: (h.score as number | null | undefined) ?? null,
          distance: (h.distance as number | null | undefined) ?? null,
          retrieve: (h.retrieve as string | null | undefined) ?? null,
          kind: (h.kind as string | null | undefined) ?? null,
        }));
        hub.broadcastRecall(sessionId, hits);
      }

      if (step.phase === "verify") {
        const out =
          step.output && typeof step.output === "object"
            ? (step.output as { ok?: boolean; output?: string })
            : {};
        hub.broadcastVerify(sessionId, {
          ok: Boolean(out.ok) && !step.error,
          exit_code: out.ok ? 0 : 1,
          log_tail: String(out.output ?? step.error ?? "").slice(-2000),
        });
      }
    },
    onAwaitingReview(preview) {
      hub.broadcastAwaitingReview(sessionId, preview);
    },
    onTerminal(status) {
      hub.broadcastTerminal(sessionId, status);
    },
    onSecurityAlert(event, detail) {
      insertAudit(db, event, detail ?? {}, projectId, sessionId);
      hub.broadcastSecurity(event, detail);
    },
  };
}

/** Persist markup workspace files for a session (extension submit path). */
export function writeSessionMarkup(
  cfg: DaemonConfig,
  db: Database,
  session: Session,
): { annotation_ref: string; workspace: string } {
  const project = getProject(db, session.project_id);
  if (!project) throw new Error("project not found");

  const workspace = defaultMarkupWorkspace(
    cfg,
    project.id,
    project.markup_workspace,
  );

  const note = session.annotation?.note;
  const selector = session.annotation?.selector;
  const slug =
    (note || selector || session.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || session.id.slice(0, 8);

  const meta = writeAnnotationWorkspace({
    workspaceDir: workspace,
    slug,
    pageUrl: session.page_url,
    note,
    selector,
    sniff: session.sniff,
  });

  updateSession(db, session.id, { annotation_ref: meta.id });
  return { annotation_ref: meta.id, workspace };
}

export async function startSessionLoop(
  cfg: DaemonConfig,
  db: Database,
  hub: SessionWsHub,
  sessionId: string,
  opts: { refineNote?: string | null } = {},
): Promise<Session> {
  if (running.has(sessionId)) {
    throw Object.assign(new Error("Loop already running for session"), {
      code: "loop_busy",
    });
  }

  const session = getSession(db, sessionId);
  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "not_found" });
  }

  const allowedStart =
    session.status === "idle" ||
    session.status === "refined" ||
    session.status === "failed";
  if (!allowedStart) {
    throw Object.assign(
      new Error(`Cannot start loop from status=${session.status}`),
      { code: "invalid_status" },
    );
  }

  const project = getProject(db, session.project_id);
  if (!project) {
    throw Object.assign(new Error("Project not found"), { code: "not_found" });
  }

  const active = countActiveSessionsForProject(db, project.id);
  // Active statuses exclude idle; block starting a new idle session while another is live.
  if (session.status === "idle" && active >= 1) {
    throw Object.assign(
      new Error("Another session is active on this project repo_path"),
      { code: "repo_busy" },
    );
  }

  // Ensure markup files exist (idempotent write).
  let annotationRef = session.annotation_ref;
  if (!annotationRef || annotationRef.startsWith("inline:")) {
    const written = writeSessionMarkup(cfg, db, session);
    annotationRef = written.annotation_ref;
  }

  const workspace = defaultMarkupWorkspace(
    cfg,
    project.id,
    project.markup_workspace,
  );
  const markupTools = createMarkupTools({
    workspaceDir: workspace,
    adapter: cfg.markupAdapter,
    licenseKey: cfg.markupLicenseKey,
  });

  const runner = selectAgentRunner(process.env);
  const fresh = getSession(db, sessionId)!;
  const componentNames = extractComponentNames(fresh.sniff);
  const knowledgeRows = matchKnowledgeForRetrieve(
    db,
    project.id,
    {
      selector: fresh.annotation?.selector,
      note: fresh.annotation?.note,
      componentNames,
    },
    10,
  );
  const knowledgeStub = knowledgeRows.map((k) => ({
    id: k.id,
    title: k.title,
    body_md: k.body_md,
    score: k.score,
    kind: k.kind,
    tags: k.tags,
    distance: k.distance,
    retrieve: k.retrieve,
  }));

  running.add(sessionId);

  try {
    const result = await runAgentLoop({
      session: {
        id: fresh.id,
        pageUrl: fresh.page_url,
        sniff: fresh.sniff,
        maxSteps: fresh.max_steps,
        stepCount: fresh.step_count,
        gitBaseSha: fresh.git_base_sha,
        tempCommitSha: fresh.temp_commit_sha,
        annotationRef: annotationRef,
      },
      project: {
        id: project.id,
        repoPath: project.repo_path,
        mode: project.mode,
        defaultBranch: project.default_branch,
        verifyCmd: project.verify_cmd,
        fileWhitelist: project.file_whitelist,
        markupWorkspace: workspace,
      },
      markupTools,
      runner,
      knowledgeStub,
      refineNote: opts.refineNote,
      lockDir: cfg.lockDir,
      hooks: makeHooks(hub, db, sessionId, project.id),
    });

    const updated = updateSession(db, sessionId, {
      status: result.status,
      step_count: result.stepCount,
      git_base_sha: result.gitBaseSha,
      temp_commit_sha: result.tempCommitSha,
      annotation_ref: annotationRef,
    });

    if (result.status === "awaiting_review") {
      hub.broadcastAwaitingReview(sessionId, {
        temp_commit_sha: result.tempCommitSha,
        summary: result.summary,
        mode: project.mode,
      });
      hub.broadcastStatus(
        sessionId,
        "awaiting_review",
        result.stepCount,
      );
      // M8a: auto-run browser acceptance gate (non-blocking for loop return).
      void import("./acceptance-gate-service.js").then(({ runSessionAcceptanceGate, resolveGateConfig }) => {
        const gateCfg = resolveGateConfig(project);
        if (!gateCfg.enabled || !gateCfg.auto_run_on_awaiting_review) return;
        return runSessionAcceptanceGate(cfg, db, hub, sessionId, "post_act");
      }).catch((err) => {
        insertAudit(
          db,
          "acceptance_gate_auto_failed",
          { message: (err as Error).message },
          project.id,
          sessionId,
        );
      });
    }

    return updated!;
  } finally {
    running.delete(sessionId);
  }
}

export async function reviewSession(
  cfg: DaemonConfig,
  db: Database,
  hub: SessionWsHub,
  sessionId: string,
  decision: ReviewDecision,
  note?: string,
  forceAccept?: boolean,
): Promise<{
  session: Session;
  knowledge_id?: string;
  pr?: unknown;
  distilled_knowledge?: {
    id: string;
    title: string;
    kind: string;
    body_preview: string;
  };
  timeline?: NonNullable<ReturnType<typeof buildSessionReadModel>>["timeline"];
}> {
  const session = getSession(db, sessionId);
  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "not_found" });
  }
  if (session.status !== "awaiting_review") {
    throw Object.assign(
      new Error(`Review requires awaiting_review (have ${session.status})`),
      { code: "invalid_status" },
    );
  }

  const project = getProject(db, session.project_id);
  if (!project) {
    throw Object.assign(new Error("Project not found"), { code: "not_found" });
  }

  if (decision === "accept") {
    const { assertAcceptAllowed } = await import("./acceptance-gate-service.js");
    assertAcceptAllowed(db, project, sessionId, forceAccept);
  }

  insertReview(db, {
    session_id: sessionId,
    decision,
    note: note ?? null,
  });
  hub.broadcastTimeline(sessionId, {
    at: Date.now(),
    kind: decision === "refine" ? "refine_note" : "review",
    label: `review · ${decision}`,
    detail: note ?? null,
    note: note,
  });

  if (decision === "revert") {
    if (!session.git_base_sha) {
      throw Object.assign(new Error("Missing git_base_sha"), {
        code: "no_base",
      });
    }
    revertSessionGit(
      project.repo_path,
      session.git_base_sha,
      cfg.lockDir,
      sessionId,
    );
    const updated = updateSession(db, sessionId, {
      status: "reverted",
      temp_commit_sha: null,
    })!;
    hub.broadcastStatus(sessionId, "reverted", updated.step_count);
    hub.broadcastTerminal(sessionId, "reverted");
    const model = buildSessionReadModel(db, sessionId);
    return { session: updated, timeline: model?.timeline };
  }

  if (decision === "refine") {
    // Keep WIP; note feeds next loop.
    const updated = updateSession(db, sessionId, {
      status: "refined",
    })!;
    hub.broadcastStatus(sessionId, "refined", updated.step_count);
    // Kick next loop asynchronously with refine note.
    void startSessionLoop(cfg, db, hub, sessionId, {
      refineNote: note ?? null,
    }).catch((err) => {
      insertAudit(
        db,
        "refine_loop_failed",
        { message: (err as Error).message },
        project.id,
        sessionId,
      );
      updateSession(db, sessionId, { status: "failed" });
      hub.broadcastStatus(sessionId, "failed", updated.step_count);
      hub.broadcastTerminal(sessionId, "failed");
    });
    const model = buildSessionReadModel(db, sessionId);
    return { session: updated, timeline: model?.timeline };
  }

  // accept → distilling → accepted
  updateSession(db, sessionId, { status: "distilling" });
  hub.broadcastStatus(sessionId, "distilling", session.step_count);

  const patch = diffPatch(
    project.repo_path,
    session.git_base_sha,
    session.temp_commit_sha,
  );
  const steps = listAgentSteps(db, sessionId);
  const actStep = [...steps].reverse().find((s) => s.phase === "act");
  const distill = buildAcceptDistill({
    sessionId,
    pageUrl: session.page_url,
    annotationNote: session.annotation?.note,
    selector: session.annotation?.selector,
    sniff: session.sniff,
    patch,
    actSummary:
      typeof actStep?.output === "object" && actStep?.output
        ? JSON.stringify(actStep.output).slice(0, 500)
        : session.annotation?.note ?? "accepted",
  });

  const distillTags = [
    ...(session.annotation?.selector
      ? [`selector:${session.annotation.selector.slice(0, 80)}`]
      : []),
    ...extractComponentNames(session.sniff).slice(0, 5),
  ];
  const knowledge = insertKnowledge(db, {
    project_id: project.id,
    session_id: sessionId,
    kind: distill.kind,
    title: distill.title,
    body_md: distill.body_md,
    tags: distillTags,
    stack: inferStack(session.sniff),
    pinned: false,
  });

  const distilled_knowledge = {
    id: knowledge.id,
    title: knowledge.title,
    kind: knowledge.kind,
    body_preview: knowledge.body_md.replace(/\s+/g, " ").trim().slice(0, 220),
  };
  hub.broadcastKnowledgeDistilled(sessionId, distilled_knowledge);
  hub.broadcastTimeline(sessionId, {
    at: Date.now(),
    kind: "distill",
    label: `distill · ${knowledge.title}`,
    detail: distilled_knowledge.body_preview,
  });

  const gitAccept = acceptSessionGit({
    project: {
      id: project.id,
      repoPath: project.repo_path,
      mode: project.mode,
      defaultBranch: project.default_branch,
      verifyCmd: project.verify_cmd,
      fileWhitelist: project.file_whitelist,
      markupWorkspace:
        project.markup_workspace ??
        defaultMarkupWorkspace(cfg, project.id, null),
    },
    sessionId,
    pageUrl: session.page_url,
  });

  if (project.mode === "pr") {
    insertAudit(
      db,
      "pr_mode_accept",
      {
        message:
          "PR mode Accept runs `gh pr create` (requires local gh auth). HMR mode keeps the local temp commit only.",
        pr: gitAccept.pr ?? null,
      },
      project.id,
      sessionId,
    );
  }

  const updated = updateSession(db, sessionId, { status: "accepted" })!;
  hub.broadcastStatus(sessionId, "accepted", updated.step_count);
  hub.broadcastTerminal(sessionId, "accepted");

  const model = buildSessionReadModel(db, sessionId);
  return {
    session: updated,
    knowledge_id: knowledge.id,
    pr: gitAccept.pr,
    distilled_knowledge,
    timeline: model?.timeline,
  };
}

export function getSessionDiff(
  db: Database,
  sessionId: string,
): {
  session_id: string;
  git_base_sha: string | null;
  temp_commit_sha: string | null;
  patch: string;
} {
  const session = getSession(db, sessionId);
  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "not_found" });
  }
  const project = getProject(db, session.project_id);
  if (!project) {
    throw Object.assign(new Error("Project not found"), { code: "not_found" });
  }
  const patch = diffPatch(
    project.repo_path,
    session.git_base_sha,
    session.temp_commit_sha,
  );
  return {
    session_id: sessionId,
    git_base_sha: session.git_base_sha,
    temp_commit_sha: session.temp_commit_sha,
    patch,
  };
}

