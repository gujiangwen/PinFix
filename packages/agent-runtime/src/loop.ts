import type { MarkupTools, AnnotationSessionDetail } from "@sightloop/markup-bridge";
import type { AgentRunner, AgentActResult } from "./runners/types.js";
import {
  createTempCommit,
  diffPatch,
  ensureGitRepo,
  getHeadSha,
  resetHard,
  runVerifyCmd,
  tryCreatePr,
} from "./git.js";
import { acquireRepoLock, type RepoLock } from "./lock.js";
import { distillOnAccept, type DistillResult } from "./distill.js";

export type LoopHooks = {
  onStatus: (
    status:
      | "retrieving"
      | "acting"
      | "awaiting_review"
      | "accepted"
      | "refined"
      | "reverted"
      | "failed"
      | "distilling",
    stepCount: number,
  ) => void;
  onStep: (step: {
    idx: number;
    phase: "retrieve" | "plan" | "act" | "verify";
    tool_name?: string | null;
    summary?: string;
    input?: unknown;
    output?: unknown;
    error?: string | null;
    duration_ms?: number | null;
    tokens_in?: number | null;
    tokens_out?: number | null;
  }) => void;
  onAwaitingReview: (preview: {
    temp_commit_sha: string | null;
    summary: string;
  }) => void;
  onTerminal: (
    status: "accepted" | "refined" | "reverted" | "failed",
  ) => void;
  onSecurityAlert?: (event: string, detail?: Record<string, unknown>) => void;
};

export type LoopSessionState = {
  id: string;
  pageUrl: string;
  sniff: unknown;
  maxSteps: number;
  stepCount: number;
  gitBaseSha: string | null;
  tempCommitSha: string | null;
  annotationRef: string | null;
};

export type LoopProject = {
  id: string;
  repoPath: string;
  mode: "hmr" | "pr";
  defaultBranch: string;
  verifyCmd: string | null;
  fileWhitelist: string[];
  markupWorkspace: string;
};

export type KnowledgeHit = {
  title: string;
  body_md: string;
  id?: string;
  score?: number;
  kind?: string;
  tags?: string[];
  distance?: number;
  retrieve?: string;
};

export type RunLoopInput = {
  session: LoopSessionState;
  project: LoopProject;
  markupTools: MarkupTools;
  runner: AgentRunner;
  knowledgeStub?: KnowledgeHit[];
  refineNote?: string | null;
  lockDir: string;
  hooks: LoopHooks;
};

export type RunLoopResult = {
  ok: boolean;
  status: "awaiting_review" | "failed";
  stepCount: number;
  gitBaseSha: string | null;
  tempCommitSha: string | null;
  summary: string;
  act?: AgentActResult;
  annotation?: AnnotationSessionDetail | null;
  error?: string;
};

const HARD_MAX_STEPS = 5;

export async function runAgentLoop(
  input: RunLoopInput,
): Promise<RunLoopResult> {
  const maxSteps = Math.min(
    Math.max(1, input.session.maxSteps || HARD_MAX_STEPS),
    HARD_MAX_STEPS,
  );
  let stepCount = input.session.stepCount;
  let lock: RepoLock | null = null;

  try {
    lock = acquireRepoLock(input.project.repoPath, {
      lockDir: input.lockDir,
      owner: input.session.id,
    });
  } catch (err) {
    input.hooks.onSecurityAlert?.("repo_lock_held", {
      repo_path: input.project.repoPath,
      message: (err as Error).message,
    });
    input.hooks.onStatus("failed", stepCount);
    input.hooks.onTerminal("failed");
    return {
      ok: false,
      status: "failed",
      stepCount,
      gitBaseSha: input.session.gitBaseSha,
      tempCommitSha: input.session.tempCommitSha,
      summary: (err as Error).message,
      error: (err as Error).message,
    };
  }

  try {
    ensureGitRepo(input.project.repoPath);
    const gitBaseSha = input.session.gitBaseSha ?? getHeadSha(input.project.repoPath);

    // --- Retrieve (hard gate) ---
    // Dual-loop: prefer project knowledge BEFORE markup annotations.
    input.hooks.onStatus("retrieving", stepCount);
    const knowledge = input.knowledgeStub ?? [];
    const knowledgeStarted = Date.now();
    input.hooks.onStep({
      idx: stepCount,
      phase: "retrieve",
      tool_name: "list_knowledge",
      summary: `project knowledge hits: ${knowledge.length} (preferred before markup)`,
      output: {
        count: knowledge.length,
        preferred: "project_knowledge",
        hits: knowledge.map((k) => ({
          id: k.id ?? null,
          title: k.title,
          score: k.score ?? null,
          kind: k.kind ?? null,
          tags: k.tags ?? [],
          distance: k.distance ?? null,
          retrieve: k.retrieve ?? null,
        })),
        engine: knowledge.some((k) => k.retrieve?.includes("sqlite-vec"))
          ? "sqlite-vec"
          : "text",
      },
      duration_ms: Date.now() - knowledgeStarted,
    });
    stepCount += 1;

    const retrieveIdx = stepCount;
    const markupStarted = Date.now();
    let annotation: AnnotationSessionDetail | null = null;
    try {
      annotation = await input.markupTools.getLatestAnnotations();
      if (
        input.session.annotationRef &&
        !input.session.annotationRef.startsWith("inline:")
      ) {
        const specific = await input.markupTools.getAnnotationSession(
          input.session.annotationRef,
        );
        if (specific) annotation = specific;
      }
      stepCount += 1;
      input.hooks.onStep({
        idx: retrieveIdx,
        phase: "retrieve",
        tool_name: "get_latest_annotations",
        summary: annotation
          ? `Retrieved markup ${annotation.id}`
          : "No annotations in workspace",
        output: annotation
          ? {
              id: annotation.id,
              selector: annotation.selector,
              after_knowledge: true,
            }
          : null,
        duration_ms: Date.now() - markupStarted,
      });
    } catch (err) {
      stepCount += 1;
      input.hooks.onStep({
        idx: retrieveIdx,
        phase: "retrieve",
        tool_name: "get_latest_annotations",
        error: (err as Error).message,
        duration_ms: Date.now() - markupStarted,
      });
      input.hooks.onStatus("failed", stepCount);
      input.hooks.onTerminal("failed");
      return {
        ok: false,
        status: "failed",
        stepCount,
        gitBaseSha,
        tempCommitSha: null,
        summary: `retrieve failed: ${(err as Error).message}`,
        error: (err as Error).message,
        annotation,
      };
    }

    if (!annotation) {
      input.hooks.onStatus("failed", stepCount);
      input.hooks.onTerminal("failed");
      return {
        ok: false,
        status: "failed",
        stepCount,
        gitBaseSha,
        tempCommitSha: null,
        summary: "Retrieve-before-act: no markup annotations found",
        error: "no_annotations",
        annotation,
      };
    }

    // --- Act ---
    input.hooks.onStatus("acting", stepCount);
    const remaining = Math.max(0, maxSteps - stepCount);
    // Always allow at least the act phase to run once, then force review on overflow.
    const stepBudget = Math.min(Math.max(remaining, 1), HARD_MAX_STEPS);

    let act: AgentActResult;
    try {
      const actStarted = Date.now();
      act = await input.runner.act({
        sessionId: input.session.id,
        repoPath: input.project.repoPath,
        pageUrl: input.session.pageUrl,
        annotation,
        sniff: input.session.sniff,
        refineNote: input.refineNote,
        knowledgeStub: knowledge,
        fileWhitelist: input.project.fileWhitelist,
        maxSteps,
        stepBudget,
      });
      input.hooks.onStep({
        idx: stepCount,
        phase: "act",
        tool_name: act.runner,
        summary: act.summary,
        output: {
          filesTouched: act.filesTouched,
          dryRun: act.dryRun,
          stepsUsed: act.stepsUsed,
          knowledge_used: knowledge.length,
        },
        duration_ms: Date.now() - actStarted,
        tokens_in: act.tokensIn ?? null,
        tokens_out: act.tokensOut ?? null,
      });
      stepCount += Math.max(1, act.stepsUsed);
    } catch (err) {
      input.hooks.onStep({
        idx: stepCount,
        phase: "act",
        tool_name: input.runner.name,
        error: (err as Error).message,
      });
      stepCount += 1;
      input.hooks.onStatus("failed", stepCount);
      input.hooks.onTerminal("failed");
      return {
        ok: false,
        status: "failed",
        stepCount,
        gitBaseSha,
        tempCommitSha: null,
        summary: `act failed: ${(err as Error).message}`,
        error: (err as Error).message,
        annotation,
      };
    }

    // max_steps overflow → awaiting_review (locked preference)
    if (stepCount >= maxSteps) {
      input.hooks.onStep({
        idx: stepCount,
        phase: "plan",
        tool_name: "max_steps_guard",
        summary: `max_steps=${maxSteps} reached — forcing awaiting_review`,
      });
    }

    // --- Verify (optional) ---
    if (input.project.verifyCmd) {
      const verify = runVerifyCmd(
        input.project.repoPath,
        input.project.verifyCmd,
      );
      input.hooks.onStep({
        idx: stepCount,
        phase: "verify",
        tool_name: "verify_cmd",
        summary: verify.ok ? "verify ok" : "verify failed",
        output: { ok: verify.ok, output: verify.output },
        error: verify.ok ? null : "verify_cmd_failed",
      });
      stepCount += 1;
      // Verify failure still goes to awaiting_review so human can Revert.
    }

    const tempCommitSha = createTempCommit(
      input.project.repoPath,
      `sightloop: wip ${input.session.id}`,
    );

    const summary = act.summary;
    input.hooks.onStatus("awaiting_review", stepCount);
    input.hooks.onAwaitingReview({
      temp_commit_sha: tempCommitSha,
      summary,
    });

    return {
      ok: true,
      status: "awaiting_review",
      stepCount,
      gitBaseSha,
      tempCommitSha,
      summary,
      act,
      annotation,
    };
  } finally {
    lock?.release();
  }
}

export type AcceptResult = {
  distill: DistillResult;
  pr?: { ok: boolean; detail: string };
};

export function buildAcceptDistill(input: {
  sessionId: string;
  pageUrl: string;
  annotationNote?: string | null;
  selector?: string | null;
  sniff: unknown;
  patch: string;
  actSummary?: string | null;
}): DistillResult {
  return distillOnAccept({
    sessionId: input.sessionId,
    pageUrl: input.pageUrl,
    annotationNote: input.annotationNote,
    selector: input.selector,
    sniffSummary: JSON.stringify(input.sniff)?.slice(0, 2000),
    patch: input.patch,
    actSummary: input.actSummary,
  });
}

export function acceptSessionGit(input: {
  project: LoopProject;
  sessionId: string;
  pageUrl: string;
}): { pr?: { ok: boolean; detail: string } } {
  if (input.project.mode !== "pr") return {};
  const pr = tryCreatePr(input.project.repoPath, {
    title: `sightloop: ${input.sessionId.slice(0, 8)}`,
    body: `Automated SightLoop Accept for ${input.pageUrl}`,
    base: input.project.defaultBranch,
  });
  return { pr };
}

export function revertSessionGit(
  repoPath: string,
  gitBaseSha: string,
  lockDir: string,
  sessionId: string,
): void {
  const lock = acquireRepoLock(repoPath, { lockDir, owner: `${sessionId}:revert` });
  try {
    resetHard(repoPath, gitBaseSha);
  } finally {
    lock.release();
  }
}

export { diffPatch, getHeadSha };
