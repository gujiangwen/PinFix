import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AgentRunner } from "@sightloop/agent-runtime";
import {
  createTempCommit,
  diffPatch,
  ensureGitRepo,
  getHeadSha,
  runVerifyCmd,
  acquireRepoLock,
} from "@sightloop/agent-runtime";
import type { PlanIR, ReviewIR } from "@sightloop/shared";
import { mockPlan } from "./mock-planner.js";
import { mockReview } from "./mock-reviewer.js";
import { assertWriteAllowed } from "./whitelist.js";

export type DualLoopHooks = {
  onStatus?: (status: string, stepCount: number) => void;
  onStep?: (step: {
    idx: number;
    phase: "retrieve" | "plan" | "act" | "verify" | "review";
    tool_name?: string | null;
    summary?: string;
    input?: unknown;
    output?: unknown;
    error?: string | null;
    duration_ms?: number;
  }) => void;
  onDualLoop?: (evt: {
    node: string;
    status: "enter" | "exit" | "error";
    summary?: string;
  }) => void;
  onPlan?: (plan: PlanIR) => void;
  onAgentReview?: (review: ReviewIR) => void;
  onSecurityAlert?: (event: string, detail?: Record<string, unknown>) => void;
  onTerminal?: (status: string) => void;
};

export type DualLoopInput = {
  session_id: string;
  project_id: string;
  repo_path: string;
  page_url: string;
  sniff?: unknown;
  annotation?: { selector?: string; note?: string } | null;
  knowledge_hits?: Array<{ title: string; body_md: string }>;
  file_whitelist: string[];
  verify_cmd?: string | null;
  max_steps: number;
  step_count: number;
  git_base_sha?: string | null;
  temp_commit_sha?: string | null;
  human_refine_note?: string | null;
  lock_dir: string;
  max_inner_refines: number;
  /** Smoke: first review forces refine once. */
  force_inner_refine_once?: boolean;
  /** Smoke: plan includes a forbidden file path to prove intercept. */
  force_plan_files?: string[];
  runner: AgentRunner;
  /** Optional gate runner; return skipped if unavailable. */
  runGate?: () => Promise<{
    status: string;
    report?: unknown;
  }>;
  hooks: DualLoopHooks;
  planner_model_label?: string;
  implementer_model_label?: string;
  reviewer_model_label?: string;
};

export type DualLoopResult = {
  status: "awaiting_review" | "failed";
  step_count: number;
  git_base_sha: string | null;
  temp_commit_sha: string | null;
  summary: string;
  plan: PlanIR | null;
  review: ReviewIR | null;
  inner_refine_count: number;
  gate_status?: string | null;
  error?: string;
};

const DualState = Annotation.Root({
  session_id: Annotation<string>,
  project_id: Annotation<string>,
  repo_path: Annotation<string>,
  page_url: Annotation<string>,
  sniff: Annotation<unknown>,
  annotation: Annotation<{ selector?: string; note?: string } | null>,
  knowledge_hits: Annotation<Array<{ title: string; body_md: string }>>,
  file_whitelist: Annotation<string[]>,
  verify_cmd: Annotation<string | null>,
  max_steps: Annotation<number>,
  step_count: Annotation<number>,
  git_base_sha: Annotation<string | null>,
  temp_commit_sha: Annotation<string | null>,
  human_refine_note: Annotation<string | null>,
  plan: Annotation<PlanIR | null>,
  review: Annotation<ReviewIR | null>,
  review_notes: Annotation<string | null>,
  inner_refine_count: Annotation<number>,
  files_touched: Annotation<string[]>,
  shell_ok: Annotation<boolean | null>,
  gate_status: Annotation<string | null>,
  terminal: Annotation<"awaiting_review" | "failed" | null>,
  summary: Annotation<string>,
  error: Annotation<string | null>,
  implement_only: Annotation<boolean>,
  /** Counts Implementer acts only (session max_steps budget). */
  act_count: Annotation<number>,
});

type S = typeof DualState.State;

export async function runDualLoop(input: DualLoopInput): Promise<DualLoopResult> {
  const hooks = input.hooks;
  let stepCount = input.step_count;
  let lock = null as ReturnType<typeof acquireRepoLock> | null;

  try {
    lock = acquireRepoLock(input.repo_path, {
      lockDir: input.lock_dir,
      owner: input.session_id,
    });
  } catch (err) {
    hooks.onSecurityAlert?.("repo_lock_held", {
      message: (err as Error).message,
    });
    return {
      status: "failed",
      step_count: stepCount,
      git_base_sha: input.git_base_sha ?? null,
      temp_commit_sha: input.temp_commit_sha ?? null,
      summary: (err as Error).message,
      plan: null,
      review: null,
      inner_refine_count: 0,
      error: (err as Error).message,
    };
  }

  try {
    ensureGitRepo(input.repo_path);
    const gitBaseSha = input.git_base_sha ?? getHeadSha(input.repo_path);

    const retrieveNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "retrieve", status: "enter" });
      hooks.onStatus?.("retrieving", stepCount);
      const started = Date.now();
      hooks.onStep?.({
        idx: stepCount,
        phase: "retrieve",
        tool_name: "list_knowledge",
        summary: `dual-loop knowledge hits: ${state.knowledge_hits.length}`,
        output: { count: state.knowledge_hits.length },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "retrieve",
        status: "exit",
        summary: `${state.knowledge_hits.length} hits`,
      });
      return {};
    };

    const plannerNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "planner", status: "enter" });
      hooks.onStatus?.("retrieving", stepCount);
      const started = Date.now();
      const plan = mockPlan({
        session_id: state.session_id,
        project_whitelist: state.file_whitelist,
        annotation: state.annotation,
        sniff: state.sniff,
        human_refine_note: state.human_refine_note,
        review_notes: state.review_notes,
        force_allowed_files: input.force_plan_files,
      });
      if (input.planner_model_label) {
        plan.planner_model = input.planner_model_label;
      }
      hooks.onPlan?.(plan);
      hooks.onStep?.({
        idx: stepCount,
        phase: "plan",
        tool_name: "mock_planner",
        summary: `Plan allowed_files=${plan.allowed_files.join(",")}`,
        output: {
          root_cause: plan.root_cause,
          allowed_files: plan.allowed_files,
          model: plan.planner_model,
        },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "planner",
        status: "exit",
        summary: plan.root_cause.slice(0, 80),
      });
      return { plan, implement_only: false };
    };

    const implementerNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "implementer", status: "enter" });
      hooks.onStatus?.("acting", stepCount);
      const plan = state.plan;
      if (!plan?.allowed_files?.length) {
        return {
          terminal: "failed",
          error: "Empty PlanIR.allowed_files",
          summary: "Planner produced empty allowlist",
        };
      }
      if (state.act_count >= state.max_steps) {
        return {
          terminal: "awaiting_review",
          summary: "max_steps (implementer acts) reached",
        };
      }

      const started = Date.now();
      // Restrict runner whitelist to exact plan files (also ⊆ project).
      const restricted = plan.allowed_files;
      let act;
      try {
        act = await input.runner.act({
          sessionId: state.session_id,
          repoPath: state.repo_path,
          pageUrl: state.page_url,
          annotation: state.annotation
            ? {
                id: "dual-loop",
                slug: "dual-loop",
                created_at: new Date().toISOString(),
                md_path: "",
                png_path: null,
                note: state.annotation.note ?? "",
                selector: state.annotation.selector,
                markdown: state.annotation.note ?? "",
              }
            : null,
          sniff: state.sniff,
          refineNote: state.review_notes ?? state.human_refine_note,
          knowledgeStub: state.knowledge_hits,
          fileWhitelist: restricted,
          maxSteps: state.max_steps,
          stepBudget: Math.max(1, state.max_steps - state.act_count),
          planAllowedFiles: restricted,
        });
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        hooks.onSecurityAlert?.("plan_whitelist_blocked", { message });
        hooks.onStep?.({
          idx: stepCount,
          phase: "act",
          tool_name: input.runner.name,
          summary: message,
          error: message,
          duration_ms: Date.now() - started,
        });
        stepCount += 1;
        return {
          terminal: "failed",
          error: message,
          summary: message,
        };
      }

      // Hard intercept: reject any touched file outside plan.
      for (const f of act.filesTouched) {
        const check = assertWriteAllowed(
          state.repo_path,
          f,
          plan.allowed_files,
          state.file_whitelist,
        );
        if (!check.ok) {
          hooks.onSecurityAlert?.(check.code, {
            file: f,
            message: check.message,
          });
          hooks.onStep?.({
            idx: stepCount,
            phase: "act",
            tool_name: "plan_whitelist_guard",
            summary: check.message,
            error: check.message,
          });
          stepCount += 1;
          return {
            terminal: "failed",
            error: check.message,
            summary: check.message,
          };
        }
      }

      const temp = createTempCommit(
        state.repo_path,
        `sightloop: dual-loop ${state.session_id.slice(0, 8)}`,
      );
      hooks.onStep?.({
        idx: stepCount,
        phase: "act",
        tool_name: act.runner,
        summary: act.summary,
        output: {
          filesTouched: act.filesTouched,
          plan_allowed: plan.allowed_files,
          model: input.implementer_model_label ?? act.runner,
        },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "implementer",
        status: "exit",
        summary: act.summary,
      });
      return {
        files_touched: act.filesTouched,
        temp_commit_sha: temp,
        git_base_sha: state.git_base_sha ?? gitBaseSha,
        summary: act.summary,
        act_count: state.act_count + (act.stepsUsed || 1),
      };
    };

    const verifyNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "verify_shell", status: "enter" });
      hooks.onStatus?.("acting", stepCount);
      const started = Date.now();
      const result = state.verify_cmd
        ? runVerifyCmd(state.repo_path, state.verify_cmd)
        : { ok: true, output: "(no verify_cmd)" };
      hooks.onStep?.({
        idx: stepCount,
        phase: "verify",
        tool_name: "verify_cmd",
        summary: result.ok ? "verify ok" : "verify failed",
        output: {
          ok: result.ok,
          log_tail: result.output?.slice(-2000),
          command: state.verify_cmd,
        },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "verify_shell",
        status: "exit",
        summary: result.ok ? "ok" : "fail",
      });
      return { shell_ok: result.ok };
    };

    const gateNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "acceptance_gate", status: "enter" });
      hooks.onStatus?.("acting", stepCount);
      const started = Date.now();
      let status = "skipped";
      let report: unknown = { status: "skipped", reason: "m8_unavailable" };
      if (input.runGate) {
        try {
          const r = await input.runGate();
          status = r.status;
          report = r.report ?? r;
        } catch (err) {
          status = "skipped";
          report = {
            status: "skipped",
            reason: (err as Error).message,
          };
        }
      }
      hooks.onStep?.({
        idx: stepCount,
        phase: "verify",
        tool_name: "acceptance_gate",
        summary: `gate ${status}`,
        output: report,
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "acceptance_gate",
        status: "exit",
        summary: status,
      });
      return { gate_status: status };
    };

    const reviewerNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "reviewer", status: "enter" });
      hooks.onStatus?.("acting", stepCount);
      const started = Date.now();
      const review = mockReview({
        session_id: state.session_id,
        shell_ok: state.shell_ok ?? true,
        gate_status: state.gate_status,
        force_refine_once: input.force_inner_refine_once,
        inner_refine_count: state.inner_refine_count,
        files_touched: state.files_touched,
        plan_allowed_files: state.plan?.allowed_files,
      });
      if (input.reviewer_model_label) {
        review.reviewer_model = input.reviewer_model_label;
      }
      hooks.onAgentReview?.(review);
      hooks.onStep?.({
        idx: stepCount,
        phase: "review",
        tool_name: "mock_reviewer",
        summary: `verdict=${review.verdict}`,
        output: review,
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "reviewer",
        status: "exit",
        summary: review.verdict,
      });
      return { review };
    };

    const finalizeNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "finalize", status: "enter" });
      const patch = diffPatch(
        state.repo_path,
        state.git_base_sha,
        state.temp_commit_sha,
      );
      const summary =
        state.summary ||
        `Dual-loop ready for human review (${patch.split("\n").length} diff lines)`;
      hooks.onStatus?.("awaiting_review", stepCount);
      hooks.onTerminal?.("awaiting_review");
      hooks.onDualLoop?.({
        node: "finalize",
        status: "exit",
        summary: "awaiting_review",
      });
      return {
        terminal: "awaiting_review",
        summary,
        git_base_sha: state.git_base_sha ?? gitBaseSha,
      };
    };

    const routeAfterReviewer = (state: S): string => {
      if (state.terminal === "failed") return "finalize";
      const verdict = state.review?.verdict;
      if (verdict === "pass") return "finalize";
      if (verdict === "refine") {
        if (state.inner_refine_count < input.max_inner_refines) {
          return state.review?.implement_only ? "implementer" : "planner";
        }
        return "finalize";
      }
      return "finalize";
    };

    const bumpRefine = async (state: S): Promise<Partial<S>> => {
      // Called when routing back — increment via planner/implementer entry.
      return {
        inner_refine_count: state.inner_refine_count + 1,
        review_notes: state.review?.notes ?? state.review_notes,
      };
    };

    const graph = new StateGraph(DualState)
      .addNode("retrieve", retrieveNode)
      .addNode("planner", plannerNode)
      .addNode("bump_refine", bumpRefine)
      .addNode("implementer", implementerNode)
      .addNode("verify_shell", verifyNode)
      .addNode("acceptance_gate", gateNode)
      .addNode("reviewer", reviewerNode)
      .addNode("finalize", finalizeNode)
      .addEdge(START, "retrieve")
      .addEdge("retrieve", "planner")
      .addEdge("planner", "implementer")
      .addEdge("implementer", "verify_shell")
      .addEdge("verify_shell", "acceptance_gate")
      .addEdge("acceptance_gate", "reviewer")
      .addConditionalEdges("reviewer", routeAfterReviewer, {
        planner: "bump_refine",
        implementer: "bump_refine",
        finalize: "finalize",
      })
      .addConditionalEdges(
        "bump_refine",
        (s) => (s.review?.implement_only ? "implementer" : "planner"),
        {
          planner: "planner",
          implementer: "implementer",
        },
      )
      .addEdge("finalize", END);

    const app = graph.compile();
    const final = await app.invoke({
      session_id: input.session_id,
      project_id: input.project_id,
      repo_path: input.repo_path,
      page_url: input.page_url,
      sniff: input.sniff ?? null,
      annotation: input.annotation ?? null,
      knowledge_hits: input.knowledge_hits ?? [],
      file_whitelist: input.file_whitelist,
      verify_cmd: input.verify_cmd ?? null,
      max_steps: input.max_steps,
      step_count: input.step_count,
      git_base_sha: gitBaseSha,
      temp_commit_sha: input.temp_commit_sha ?? null,
      human_refine_note: input.human_refine_note ?? null,
      plan: null,
      review: null,
      review_notes: null,
      inner_refine_count: 0,
      files_touched: [],
      shell_ok: null,
      gate_status: null,
      terminal: null,
      summary: "",
      error: null,
      implement_only: false,
      act_count: 0,
    });

    return {
      status: (final.terminal as "awaiting_review" | "failed") ?? "awaiting_review",
      step_count: stepCount,
      git_base_sha: (final.git_base_sha as string | null) ?? gitBaseSha,
      temp_commit_sha: (final.temp_commit_sha as string | null) ?? null,
      summary: (final.summary as string) || "dual-loop complete",
      plan: (final.plan as PlanIR | null) ?? null,
      review: (final.review as ReviewIR | null) ?? null,
      inner_refine_count: (final.inner_refine_count as number) ?? 0,
      gate_status: (final.gate_status as string | null) ?? null,
      error: (final.error as string | null) ?? undefined,
    };
  } finally {
    lock?.release();
  }
}
