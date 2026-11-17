import { join, resolve } from "node:path";
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
  setSessionPlan,
  setSessionAgentReview,
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
    if (cfg.dualLoop) {
      const { runDualLoop, retrieveAcceptanceHits } = await import(
        "@sightloop/dual-loop"
      );
      const acceptance_hits = retrieveAcceptanceHits(
        project.repo_path,
        {
          note: fresh.annotation?.note,
          selector: fresh.annotation?.selector,
        },
        3,
      );
      const dual = await runDualLoop({
        session_id: fresh.id,
        project_id: project.id,
        repo_path: project.repo_path,
        page_url: fresh.page_url,
        sniff: fresh.sniff,
        annotation: fresh.annotation
          ? {
              selector: fresh.annotation.selector,
              note: fresh.annotation.note,
            }
          : null,
        knowledge_hits: knowledgeStub.map((k) => ({
          title: k.title,
          body_md: k.body_md,
        })),
        acceptance_hits,
        file_whitelist: project.file_whitelist,
        verify_cmd: project.verify_cmd,
        max_steps: fresh.max_steps,
        step_count: fresh.step_count,
        git_base_sha: fresh.git_base_sha,
        temp_commit_sha: fresh.temp_commit_sha,
        human_refine_note: opts.refineNote ?? null,
        lock_dir: cfg.lockDir,
        max_inner_refines: cfg.maxInnerRefines,
        force_inner_refine_once: process.env.SIGHTLOOP_DUAL_LOOP_FORCE_REFINE === "1",
        force_plan_files: process.env.SIGHTLOOP_DUAL_LOOP_FORCE_PLAN_FILES
          ? process.env.SIGHTLOOP_DUAL_LOOP_FORCE_PLAN_FILES.split(",").map((s) =>
              s.trim(),
            )
          : undefined,
        runner,
        use_mock_llm: cfg.dualLoopMock,
        max_plan_attempts: cfg.maxPlanAttempts,
        planner_model_label: cfg.plannerModel ?? (cfg.dualLoopMock ? "mock-planner" : null) ?? undefined,
        implementer_model_label:
          cfg.implementerModel ?? runner.name,
        reviewer_model_label:
          cfg.reviewerModel ?? (cfg.dualLoopMock ? "mock-reviewer" : null) ?? undefined,
        runGate: async () => {
          try {
            const { runSessionAcceptanceGate, resolveGateConfig } =
              await import("./acceptance-gate-service.js");
            const gateCfg = resolveGateConfig(project);
            if (!gateCfg.enabled) {
              return { status: "skipped", report: { reason: "disabled" } };
            }
            // Prefer skip during dual-loop to avoid double-run; M8a still auto-runs after awaiting_review.
            return { status: "skipped", report: { reason: "deferred_to_post_act" } };
          } catch {
            return { status: "skipped", report: { reason: "m8_unavailable" } };
          }
        },
        hooks: {
          onStatus(status, stepCount) {
            updateSession(db, sessionId, {
              status: status as Session["status"],
              step_count: stepCount,
            });
            hub.broadcastStatus(sessionId, status as Session["status"], stepCount);
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
            });
            hub.broadcastStep(sessionId, {
              idx: step.idx,
              phase: step.phase,
              tool_name: step.tool_name,
              summary: step.summary,
            });
            hub.broadcastTimeline(sessionId, {
              at: Date.now(),
              kind: "step",
              label: `${step.phase}${step.tool_name ? ` · ${step.tool_name}` : ""}`,
              detail: step.summary ?? step.error ?? null,
            });
          },
          onDualLoop(evt) {
            hub.broadcastDualLoop(sessionId, evt);
          },
          onPlan(plan) {
            setSessionPlan(db, sessionId, plan);
            hub.broadcastPlan(sessionId, plan as unknown as Record<string, unknown>);
          },
          onAgentReview(review) {
            setSessionAgentReview(db, sessionId, review);
            hub.broadcastAgentReview(
              sessionId,
              review as unknown as Record<string, unknown>,
            );
          },
          onSecurityAlert(event, detail) {
            insertAudit(db, event, detail ?? {}, project.id, sessionId);
            hub.broadcastSecurity(event, detail);
          },
          onTerminal(status) {
            hub.broadcastTerminal(sessionId, status as Session["status"]);
          },
        },
      });

      if (dual.plan) setSessionPlan(db, sessionId, dual.plan, dual.inner_refine_count);
      if (dual.review) setSessionAgentReview(db, sessionId, dual.review);

      const updated = updateSession(db, sessionId, {
        status: dual.status,
        step_count: dual.step_count,
        git_base_sha: dual.git_base_sha,
        temp_commit_sha: dual.temp_commit_sha,
        annotation_ref: annotationRef,
      });

      if (dual.status === "awaiting_review") {
        hub.broadcastAwaitingReview(sessionId, {
          temp_commit_sha: dual.temp_commit_sha,
          summary: dual.summary,
          mode: project.mode,
        });
        hub.broadcastStatus(sessionId, "awaiting_review", dual.step_count);
        void import("./acceptance-gate-service.js")
          .then(({ runSessionAcceptanceGate, resolveGateConfig }) => {
            const gateCfg = resolveGateConfig(project);
            if (!gateCfg.enabled || !gateCfg.auto_run_on_awaiting_review) return;
            return runSessionAcceptanceGate(cfg, db, hub, sessionId, "post_act");
          })
          .catch((err) => {
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
    }

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
  deploy?: {
    ok: boolean;
    detail: string;
    heal_hint: string | null;
  };
  acceptance_archive?: {
    ok: boolean;
    path: string | null;
    detail: string;
  };
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

  let acceptance_archive:
    | { ok: boolean; path: string | null; detail: string }
    | undefined;
  if (process.env.SIGHTLOOP_ACCEPTANCE_ARCHIVE !== "0") {
    try {
      const { getLatestAcceptanceRun } = await import("@sightloop/db");
      const { artifactsRoot } = await import("./acceptance-gate-service.js");
      const { archiveAcceptanceToRepo } = await import(
        "./acceptance-archive.js"
      );
      const latest = getLatestAcceptanceRun(db, sessionId);
      if (latest?.scenario && latest.fingerprint) {
        const archived = archiveAcceptanceToRepo({
          repoPath: project.repo_path,
          projectId: project.id,
          sessionId,
          fingerprint: latest.fingerprint,
          scenario: latest.scenario,
          startUrl: latest.start_url,
          baselinesRoot: join(artifactsRoot(cfg), "baselines"),
          report: latest.report,
        });
        acceptance_archive = archived;
        insertAudit(
          db,
          "acceptance_archived",
          archived,
          project.id,
          sessionId,
        );
      } else {
        acceptance_archive = {
          ok: false,
          path: null,
          detail: "no_gate_run",
        };
        insertAudit(
          db,
          "acceptance_archive_skipped",
          { reason: "no_gate_run" },
          project.id,
          sessionId,
        );
      }
    } catch (err) {
      acceptance_archive = {
        ok: false,
        path: null,
        detail: (err as Error).message,
      };
      insertAudit(
        db,
        "acceptance_archive_failed",
        { message: (err as Error).message },
        project.id,
        sessionId,
      );
    }
  }

  let deploy:
    | {
        ok: boolean;
        detail: string;
        heal_hint: string | null;
      }
    | undefined;

  if (project.mode === "pr") {
    const { deployHealHint, probeGithubHealth } = await import(
      "./github-health.js"
    );
    const pr = gitAccept.pr ?? { ok: false, detail: "pr_create_skipped" };
    deploy = {
      ok: Boolean(pr.ok),
      detail: pr.detail,
      heal_hint: pr.ok ? null : deployHealHint(),
    };
    if (!pr.ok) {
      // Refresh probe so DX lights catch up after a failed deploy.
      probeGithubHealth(true);
    }
    insertAudit(
      db,
      "pr_mode_accept",
      {
        message:
          "PR mode Accept runs `gh pr create` (requires local gh auth). HMR mode keeps the local temp commit only.",
        pr: gitAccept.pr ?? null,
        deploy,
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
    deploy,
    acceptance_archive,
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

