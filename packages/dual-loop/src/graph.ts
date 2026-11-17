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
import type { PlanIR, RefineIR, ReviewIR } from "@sightloop/shared";
import { callPlanner } from "./llm-planner.js";
import { callReviewer } from "./llm-reviewer.js";
import {
  refineFromContractFailure,
  refineFromGateFailure,
  refineFromReviewer,
  refineFromShellFailure,
  refineFromWhitelistBlock,
} from "./refine-ir.js";
import {
  autoBindEditEvidence,
  refineFromEditWithoutEvidence,
} from "./edit-evidence.js";
import {
  evaluateMutationProxy,
  mutationGateEnabled,
} from "./mutation-gate.js";
import {
  crossJudgeEnabled,
  mergeCrossJudge,
  mockJudge,
} from "./cross-judge.js";
import {
  resolveJudgeConfig,
  resolvePlannerConfig,
  resolveReviewerConfig,
  type RoleLlmConfig,
} from "./role-config.js";
import { runVerifyContractShell } from "./verify-contract.js";
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
  onRefineIR?: (refine: RefineIR) => void;
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
  /** M9a mock / M9b llm. When llm and no planner key → mock fallback. */
  use_mock_llm?: boolean;
  max_plan_attempts?: number;
  planner_config?: RoleLlmConfig;
  reviewer_config?: RoleLlmConfig;
  planner_model_label?: string;
  implementer_model_label?: string;
  reviewer_model_label?: string;
  /** Inject fetch for LLM unit/integration tests. */
  fetchImpl?: typeof fetch;
  /** M11c: acceptance archive retrieval hits for Planner. */
  acceptance_hits?: Array<{ title: string; path: string; score?: number }>;
  /** M12a: strategy memory hits for Planner. */
  strategy_hits?: Array<{
    title: string;
    path: string;
    score?: number;
    pattern_id?: string;
  }>;
  /** M12b smoke: refuse auto evidence bind. */
  forbid_edit_evidence_auto?: boolean;
  /** M12e smoke: force judge disagreement. */
  force_judge_disagree?: boolean;
};

export type DualLoopResult = {
  status: "awaiting_review" | "failed";
  step_count: number;
  git_base_sha: string | null;
  temp_commit_sha: string | null;
  summary: string;
  plan: PlanIR | null;
  review: ReviewIR | null;
  refine_ir: RefineIR | null;
  inner_refine_count: number;
  gate_status?: string | null;
  verify_contract_unmet?: boolean;
  /** R2: budget exhausted with unbound edits — human review, no infinite loop. */
  edit_evidence_unmet?: boolean;
  /**
   * R9: agent-side judge/reviewer pass only — NOT Human Accept.
   * True when ReviewIR.verdict=pass (and cross-judge agreed if enabled).
   */
  agent_judge_pass?: boolean;
  judge_skipped?: boolean;
  judge_skip_reason?: string | null;
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
  refine_ir: Annotation<RefineIR | null>,
  shell_log: Annotation<string | null>,
  gate_report: Annotation<unknown>,
  contract_results: Annotation<
    Record<string, { ok: boolean; summary: string; excerpt?: string }>
  >,
  verify_contract_unmet: Annotation<boolean>,
  edit_evidence: Annotation<
    Array<{
      hunk_id: string;
      files: string[];
      evidence_refs: Array<{ kind: string; id: string; note?: string }>;
    }>
  >,
  edit_evidence_unmet: Annotation<boolean>,
  /** Skip verify/gate/reviewer and go refine or finalize. */
  after_implementer: Annotation<"verify" | "refine" | "finalize">,
  judge_skipped: Annotation<boolean>,
  judge_skip_reason: Annotation<string | null>,
  agent_judge_pass: Annotation<boolean>,
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
      refine_ir: null,
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

    const plannerCfg =
      input.planner_config ?? resolvePlannerConfig(process.env);
    const reviewerCfg =
      input.reviewer_config ?? resolveReviewerConfig(process.env);
    const useMock = input.use_mock_llm !== false;

    const plannerNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "planner", status: "enter" });
      hooks.onStatus?.("retrieving", stepCount);
      const started = Date.now();
      let result;
      try {
        result = await callPlanner({
          input: {
            session_id: state.session_id,
            project_whitelist: state.file_whitelist,
            annotation: state.annotation,
            sniff: state.sniff,
            human_refine_note: state.human_refine_note,
            review_notes: state.review_notes,
            force_allowed_files: input.force_plan_files,
            suggested_allowed_files: state.review?.suggested_allowed_files,
            knowledge_hits: state.knowledge_hits,
            refine_ir: state.refine_ir,
            verify_cmd: state.verify_cmd,
            acceptance_hits: input.acceptance_hits,
            strategy_hits: input.strategy_hits,
          },
          config: plannerCfg,
          useMock,
          maxAttempts: input.max_plan_attempts ?? 2,
          fetchImpl: input.fetchImpl,
        });
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        if (message.startsWith("plan_missing_issue_resolution")) {
          hooks.onSecurityAlert?.("plan_missing_issue_resolution", {
            message,
          });
        }
        return {
          terminal: "failed",
          error: message,
          summary: message,
        };
      }
      const plan = result.plan;
      if (input.planner_model_label && result.backend === "mock") {
        plan.planner_model = input.planner_model_label;
      }
      if (result.fallback_reason && result.fallback_reason !== "dual_loop_mock") {
        hooks.onSecurityAlert?.("planner_llm_fallback", {
          reason: result.fallback_reason,
          attempts: result.attempts,
        });
      }
      if (input.acceptance_hits?.length) {
        hooks.onSecurityAlert?.("acceptance_retrieved", {
          count: input.acceptance_hits.length,
          ids: input.acceptance_hits.map((h) => h.path),
        });
      }
      if (input.strategy_hits?.length) {
        hooks.onSecurityAlert?.("strategy_retrieved", {
          count: input.strategy_hits.length,
          ids: input.strategy_hits.map((h) => h.path),
        });
      }
      hooks.onPlan?.(plan);
      hooks.onStep?.({
        idx: stepCount,
        phase: "plan",
        tool_name: result.backend === "llm" ? "llm_planner" : "mock_planner",
        summary: `Plan[${result.backend}] allowed_files=${plan.allowed_files.join(",")}`,
        output: {
          root_cause: plan.root_cause,
          allowed_files: plan.allowed_files,
          model: plan.planner_model,
          backend: result.backend,
          fallback_reason: result.fallback_reason ?? null,
          attempts: result.attempts,
          issue_resolutions: plan.issue_resolutions ?? [],
          verify_contract: plan.verify_contract ?? null,
          test_first: plan.test_first ?? null,
          strategy_hits: input.strategy_hits ?? [],
          refine_ir: state.refine_ir,
        },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "planner",
        status: "exit",
        summary: `${result.backend}: ${plan.root_cause.slice(0, 80)}`,
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
          const refine = refineFromWhitelistBlock({
            session_id: state.session_id,
            path: f,
            message: check.message,
          });
          hooks.onRefineIR?.(refine);
          hooks.onSecurityAlert?.("refine_ir_emitted", {
            source: refine.source,
            issues: refine.blocking_issues.length,
          });
          hooks.onStep?.({
            idx: stepCount,
            phase: "act",
            tool_name: "plan_whitelist_guard",
            summary: check.message,
            error: check.message,
            output: { refine_ir: refine },
          });
          stepCount += 1;
          return {
            terminal: "failed",
            error: check.message,
            summary: check.message,
            refine_ir: refine,
          };
        }
      }

      const temp = createTempCommit(
        state.repo_path,
        `sightloop: dual-loop ${state.session_id.slice(0, 8)}`,
      );

      // M12b: every write hunk must bind evidence (mock auto-binds).
      const patch = diffPatch(
        state.repo_path,
        state.git_base_sha ?? gitBaseSha,
        temp,
      );
      const bound = autoBindEditEvidence({
        patch,
        files_touched: act.filesTouched,
        plan,
        refine_ir: state.refine_ir,
        sniff_selector:
          state.annotation?.selector ??
          (typeof (state.sniff as { selector?: string } | null)?.selector ===
          "string"
            ? (state.sniff as { selector: string }).selector
            : null),
        strategy_ids: (input.strategy_hits ?? []).map(
          (h) => h.pattern_id ?? h.path,
        ),
        project_whitelist: state.file_whitelist,
        forbid_auto:
          input.forbid_edit_evidence_auto ||
          process.env.SIGHTLOOP_FORBID_EDIT_EVIDENCE === "1",
      });
      if (!bound.ok) {
        const refine = refineFromEditWithoutEvidence({
          session_id: state.session_id,
          missing_hunks: bound.missing,
        });
        hooks.onRefineIR?.(refine);
        hooks.onSecurityAlert?.("edit_without_evidence", {
          missing: bound.missing,
        });
        hooks.onSecurityAlert?.("refine_ir_emitted", {
          source: refine.source,
          issues: refine.blocking_issues.length,
        });
        hooks.onStep?.({
          idx: stepCount,
          phase: "act",
          tool_name: "edit_evidence_guard",
          summary: `edit_without_evidence: ${bound.missing.join(",")}`,
          error: "edit_without_evidence",
          output: { refine_ir: refine, edit_evidence: bound.evidence },
          duration_ms: Date.now() - started,
        });
        stepCount += 1;
        // R2: budget remaining → refine (no verify loop); exhausted → awaiting_review + edit_evidence_unmet.
        if (state.inner_refine_count < input.max_inner_refines) {
          return {
            files_touched: act.filesTouched,
            temp_commit_sha: temp,
            git_base_sha: state.git_base_sha ?? gitBaseSha,
            summary: act.summary,
            act_count: state.act_count + (act.stepsUsed || 1),
            refine_ir: refine,
            edit_evidence: bound.evidence,
            edit_evidence_unmet: true,
            after_implementer: "refine",
            review: {
              version: 1 as const,
              session_id: state.session_id,
              verdict: "refine" as const,
              notes: "edit_without_evidence",
              blocking_issues: [
                {
                  code: "other" as const,
                  message: `edit_without_evidence: ${bound.missing.join(",")}`,
                },
              ],
              consume_gate: true,
            },
          };
        }
        return {
          files_touched: act.filesTouched,
          temp_commit_sha: temp,
          git_base_sha: state.git_base_sha ?? gitBaseSha,
          summary: "edit_evidence_unmet — awaiting human (budget exhausted)",
          act_count: state.act_count + (act.stepsUsed || 1),
          refine_ir: refine,
          edit_evidence: bound.evidence,
          edit_evidence_unmet: true,
          after_implementer: "finalize",
          terminal: "awaiting_review",
        };
      }

      hooks.onStep?.({
        idx: stepCount,
        phase: "act",
        tool_name: act.runner,
        summary: act.summary,
        output: {
          filesTouched: act.filesTouched,
          plan_allowed: plan.allowed_files,
          model: input.implementer_model_label ?? act.runner,
          edit_evidence: bound.evidence,
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
        edit_evidence: bound.evidence,
        edit_evidence_unmet: false,
        after_implementer: "verify",
      };
    };

    const verifyNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "verify_shell", status: "enter" });
      hooks.onStatus?.("acting", stepCount);
      const started = Date.now();
      // M11b: prefer PlanIR.verify_contract.shell; fall back to project verify_cmd.
      const contractRun = runVerifyContractShell(
        state.repo_path,
        state.plan?.verify_contract,
      );
      let shellOk = contractRun.ok;
      let shellLog = Object.values(contractRun.results)
        .map((r) => r.excerpt ?? r.summary)
        .join("\n")
        .slice(-4000);
      let refine: RefineIR | null = null;

      if (!state.plan?.verify_contract && state.verify_cmd) {
        const result = runVerifyCmd(state.repo_path, state.verify_cmd);
        shellOk = result.ok;
        shellLog = result.output?.slice(-4000) ?? "";
        if (!result.ok) {
          refine = refineFromShellFailure({
            session_id: state.session_id,
            cmd: state.verify_cmd,
            output: result.output,
          });
        }
      } else if (!contractRun.ok) {
        refine = refineFromContractFailure({
          session_id: state.session_id,
          failures: contractRun.failures,
        });
      }

      if (refine) {
        hooks.onRefineIR?.(refine);
        hooks.onSecurityAlert?.("refine_ir_emitted", {
          source: refine.source,
          issues: refine.blocking_issues.length,
        });
      }

      hooks.onStep?.({
        idx: stepCount,
        phase: "verify",
        tool_name: "verify_contract",
        summary: shellOk ? "verify ok" : "verify failed",
        output: {
          ok: shellOk,
          log_tail: shellLog?.slice(-2000),
          contract_results: contractRun.results,
          refine_ir: refine,
        },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "verify_shell",
        status: "exit",
        summary: shellOk ? "ok" : "fail",
      });
      return {
        shell_ok: shellOk,
        shell_log: shellLog,
        contract_results: contractRun.results,
        refine_ir: refine ?? state.refine_ir,
        verify_contract_unmet: !shellOk,
      };
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
      let refine: RefineIR | null = null;
      if (status !== "passed" && status !== "skipped") {
        refine = refineFromGateFailure({
          session_id: state.session_id,
          gate_status: status,
          report,
        });
        hooks.onRefineIR?.(refine);
        hooks.onSecurityAlert?.("refine_ir_emitted", {
          source: refine.source,
          issues: refine.blocking_issues.length,
        });
      }
      hooks.onStep?.({
        idx: stepCount,
        phase: "verify",
        tool_name: "acceptance_gate",
        summary: `gate ${status}`,
        output: { report, refine_ir: refine },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "acceptance_gate",
        status: "exit",
        summary: status,
      });
      return {
        gate_status: status,
        gate_report: report,
        refine_ir: refine ?? state.refine_ir,
      };
    };

    const reviewerNode = async (state: S): Promise<Partial<S>> => {
      hooks.onDualLoop?.({ node: "reviewer", status: "enter" });
      hooks.onStatus?.("acting", stepCount);
      const started = Date.now();
      // R5: short context for judge — IR + diff summary + contract results only.
      const diffSummary = diffPatch(
        state.repo_path,
        state.git_base_sha,
        state.temp_commit_sha,
      ).slice(0, 4000);
      const contractOk = !state.verify_contract_unmet;

      // R3: light mutation proxy; only enforce when MUTATION_GATE=1.
      const mutation = evaluateMutationProxy({
        contract_results: state.contract_results,
        test_first_paths: state.plan?.test_first?.paths,
      });
      const mutationBlocks =
        mutationGateEnabled() &&
        (state.shell_ok ?? true) &&
        contractOk &&
        !mutation.met;

      const result = await callReviewer({
        input: {
          session_id: state.session_id,
          shell_ok: (state.shell_ok ?? true) && contractOk && !mutationBlocks,
          gate_status: state.gate_status,
          force_refine_once: input.force_inner_refine_once,
          inner_refine_count: state.inner_refine_count,
          files_touched: state.files_touched,
          plan_allowed_files: state.plan?.allowed_files,
          plan: state.plan,
          diff_summary: diffSummary,
          contract_results: state.contract_results,
          mutation_or_coverage: mutation,
        },
        config: reviewerCfg,
        useMock,
        maxAttempts: input.max_plan_attempts ?? 2,
        fetchImpl: input.fetchImpl,
      });
      let review = result.review;
      if (input.reviewer_model_label && result.backend === "mock") {
        review.reviewer_model = input.reviewer_model_label;
      }

      if (mutationBlocks && review.verdict === "pass") {
        review = {
          ...review,
          verdict: "refine",
          notes: `mutation_gate unmet: score=${mutation.score} < ${mutation.threshold}`,
          blocking_issues: [
            ...(review.blocking_issues ?? []),
            {
              code: "verify_failed",
              message: `mutation_or_coverage unmet (${mutation.detail ?? ""})`,
            },
          ],
          pass_evidence: undefined,
        };
      }

      // Pass must cite contract evidence when require_all_green.
      if (
        review.verdict === "pass" &&
        state.plan?.verify_contract?.require_all_green !== false
      ) {
        const needed = [
          ...(state.plan?.verify_contract?.shell ?? []).map((s) => s.id),
          ...(state.plan?.verify_contract?.scenario_refs ?? []).map((s) => s.id),
        ];
        const cited = new Set(
          (review.pass_evidence ?? [])
            .filter((e) => e.result === "pass" || e.result === "skip")
            .map((e) => e.contract_item_id),
        );
        const missing = needed.filter((id) => !cited.has(id));
        if (needed.length && missing.length) {
          review = {
            ...review,
            verdict: "refine",
            notes: `pass_evidence missing for: ${missing.join(",")}`,
            blocking_issues: [
              ...(review.blocking_issues ?? []),
              {
                code: "other",
                message: `Pass evidence missing: ${missing.join(",")}`,
              },
            ],
            pass_evidence: undefined,
          };
        }
      }
      if (
        result.fallback_reason &&
        result.fallback_reason !== "dual_loop_mock" &&
        result.fallback_reason !== "force_refine_once"
      ) {
        hooks.onSecurityAlert?.("reviewer_llm_fallback", {
          reason: result.fallback_reason,
          attempts: result.attempts,
        });
      }

      // M12e / R5: cross-model judge (default off).
      let judge_skipped = true;
      let judge_skip_reason: string | null = "CROSS_JUDGE=0";
      if (crossJudgeEnabled()) {
        const judgeCfg = resolveJudgeConfig(process.env);
        if (!judgeCfg.keyConfigured && !useMock) {
          judge_skipped = true;
          judge_skip_reason = "no_judge_api_key";
          hooks.onSecurityAlert?.("judge_skipped", { reason: judge_skip_reason });
        } else {
          const forceDisagree =
            input.force_judge_disagree ||
            process.env.SIGHTLOOP_FORCE_JUDGE_DISAGREE === "1";
          const judgeReview = mockJudge({
            session_id: state.session_id,
            primary: review,
            force_disagree: forceDisagree,
          });
          const merged = mergeCrossJudge({
            primary: review,
            judge: judgeReview,
            skipped: false,
          });
          review = merged.review;
          judge_skipped = merged.skipped;
          judge_skip_reason = merged.skip_reason ?? null;
          hooks.onSecurityAlert?.("cross_judge", {
            agreed: merged.agreed,
            primary: merged.review.verdict,
            judge: judgeReview.verdict,
          });
        }
      }

      let refine = state.refine_ir;
      if (review.verdict === "refine") {
        refine = refineFromReviewer({
          session_id: state.session_id,
          review,
        });
        hooks.onRefineIR?.(refine);
        hooks.onSecurityAlert?.("refine_ir_emitted", {
          source: refine.source,
          issues: refine.blocking_issues.length,
        });
      }

      // R9: agent_judge_pass ≠ Human Accept
      const agent_judge_pass = review.verdict === "pass";

      hooks.onAgentReview?.(review);
      hooks.onStep?.({
        idx: stepCount,
        phase: "review",
        tool_name: result.backend === "llm" ? "llm_reviewer" : "mock_reviewer",
        summary: `verdict=${review.verdict} [${result.backend}] agent_judge_pass=${agent_judge_pass}`,
        output: {
          ...review,
          backend: result.backend,
          fallback_reason: result.fallback_reason ?? null,
          refine_ir: refine,
          agent_judge_pass,
          judge_skipped,
          judge_skip_reason,
          mutation_or_coverage: mutation,
          // Explicit: not Human Accept
          human_accept: false,
        },
        duration_ms: Date.now() - started,
      });
      stepCount += 1;
      hooks.onDualLoop?.({
        node: "reviewer",
        status: "exit",
        summary: `${review.verdict}/${result.backend}`,
      });
      return {
        review,
        refine_ir: refine,
        judge_skipped,
        judge_skip_reason,
        agent_judge_pass,
      };
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
      const refine =
        state.refine_ir ??
        (state.review
          ? refineFromReviewer({
              session_id: state.session_id,
              review: state.review,
            })
          : null);
      return {
        inner_refine_count: state.inner_refine_count + 1,
        review_notes: state.review?.notes ?? state.review_notes,
        refine_ir: refine,
        verify_contract_unmet: false,
      };
    };

    const routeAfterImplementer = (state: S): string => {
      if (state.terminal === "failed") return "finalize";
      if (state.after_implementer === "finalize" || state.terminal === "awaiting_review") {
        return "finalize";
      }
      if (state.after_implementer === "refine") return "bump_refine";
      return "verify_shell";
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
      .addConditionalEdges("implementer", routeAfterImplementer, {
        verify_shell: "verify_shell",
        bump_refine: "bump_refine",
        finalize: "finalize",
      })
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
      refine_ir: null,
      shell_log: null,
      gate_report: null,
      contract_results: {},
      verify_contract_unmet: false,
      edit_evidence: [],
      edit_evidence_unmet: false,
      after_implementer: "verify",
      judge_skipped: true,
      judge_skip_reason: "CROSS_JUDGE=0",
      agent_judge_pass: false,
    });

    const reviewOut = (final.review as ReviewIR | null) ?? null;
    return {
      status: (final.terminal as "awaiting_review" | "failed") ?? "awaiting_review",
      step_count: stepCount,
      git_base_sha: (final.git_base_sha as string | null) ?? gitBaseSha,
      temp_commit_sha: (final.temp_commit_sha as string | null) ?? null,
      summary: (final.summary as string) || "dual-loop complete",
      plan: (final.plan as PlanIR | null) ?? null,
      review: reviewOut,
      refine_ir: (final.refine_ir as RefineIR | null) ?? null,
      inner_refine_count: (final.inner_refine_count as number) ?? 0,
      gate_status: (final.gate_status as string | null) ?? null,
      verify_contract_unmet: Boolean(final.verify_contract_unmet),
      edit_evidence_unmet: Boolean(final.edit_evidence_unmet),
      agent_judge_pass: Boolean(
        final.agent_judge_pass ?? reviewOut?.verdict === "pass",
      ),
      judge_skipped: final.judge_skipped !== false,
      judge_skip_reason: (final.judge_skip_reason as string | null) ?? null,
      error: (final.error as string | null) ?? undefined,
    };
  } finally {
    lock?.release();
  }
}
