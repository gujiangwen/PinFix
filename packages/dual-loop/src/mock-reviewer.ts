import {
  ReviewIRSchema,
  type PlanIR,
  type ReviewIR,
  type VerifyContract,
} from "@sightloop/shared";

export type MockReviewerInput = {
  session_id: string;
  shell_ok?: boolean;
  gate_status?: string | null;
  /** Force refine once for smoke (e.g. when inner_refine_count === 0). */
  force_refine_once?: boolean;
  inner_refine_count?: number;
  files_touched?: string[];
  plan_allowed_files?: string[];
  plan?: PlanIR | null;
  /** M11b: contract run results keyed by item id. */
  contract_results?: Record<string, { ok: boolean; summary: string }>;
  /** M12c: attach mutation/coverage proxy on pass evidence. */
  mutation_or_coverage?: {
    score: number;
    threshold: number;
    met: boolean;
    detail?: string;
  };
};

function buildPassEvidence(
  contract: VerifyContract | undefined,
  contractResults: Record<string, { ok: boolean; summary: string }> | undefined,
  shellOk: boolean,
  gateStatus: string | null | undefined,
): ReviewIR["pass_evidence"] {
  const evidence: NonNullable<ReviewIR["pass_evidence"]> = [];
  const items = contract?.shell ?? [];
  if (items.length) {
    for (const item of items) {
      const r = contractResults?.[item.id];
      const ok = r ? r.ok : shellOk;
      evidence.push({
        contract_item_id: item.id,
        result: ok ? "pass" : "pass", // only called on pass path when green
        summary: r?.summary ?? (ok ? "shell ok" : "shell ok (assumed)"),
      });
    }
  } else {
    evidence.push({
      contract_item_id: "shell:legacy_verify",
      result: shellOk ? "pass" : "skip",
      summary: shellOk ? "legacy verify ok" : "no shell contract",
    });
  }
  for (const ref of contract?.scenario_refs ?? []) {
    const gateOk =
      !gateStatus || gateStatus === "passed" || gateStatus === "skipped";
    evidence.push({
      contract_item_id: ref.id,
      result: gateStatus === "skipped" ? "skip" : gateOk ? "pass" : "pass",
      summary: `gate ${gateStatus ?? "n/a"} · ${ref.assertion_id}`,
    });
  }
  return evidence;
}

/**
 * Mock reviewer: shell/gate failure → refine; else pass with M11b evidence.
 */
export function mockReview(input: MockReviewerInput): ReviewIR {
  const issues: ReviewIR["blocking_issues"] = [];

  if (input.shell_ok === false) {
    issues.push({
      code: "verify_failed",
      message: "Shell verify_cmd failed",
    });
  }
  if (
    input.gate_status &&
    input.gate_status !== "passed" &&
    input.gate_status !== "skipped"
  ) {
    issues.push({
      code: "gate_failed",
      message: `Acceptance gate status=${input.gate_status}`,
    });
  }

  // M11b: contract failures
  for (const [id, r] of Object.entries(input.contract_results ?? {})) {
    if (!r.ok) {
      issues.push({
        code: "verify_failed",
        message: `verify_contract ${id}: ${r.summary}`,
      });
    }
  }

  if (
    input.force_refine_once &&
    (input.inner_refine_count ?? 0) === 0 &&
    issues.length === 0
  ) {
    issues.push({
      code: "other",
      message: "Mock reviewer requests one inner refine for topology smoke",
    });
  }

  if (input.files_touched && input.plan_allowed_files) {
    for (const f of input.files_touched) {
      if (!input.plan_allowed_files.includes(f)) {
        issues.push({
          code: "diff_unrelated",
          message: `Touched ${f} outside plan`,
        });
      }
    }
  }

  if (issues.length) {
    return ReviewIRSchema.parse({
      version: 1,
      session_id: input.session_id,
      verdict: "refine",
      notes: issues.map((i) => i.message).join("; "),
      blocking_issues: issues,
      reviewer_model: "mock-reviewer",
      consume_gate: true,
    });
  }

  const contract = input.plan?.verify_contract;
  let pass_evidence = buildPassEvidence(
    contract,
    input.contract_results,
    input.shell_ok ?? true,
    input.gate_status,
  );

  if (input.mutation_or_coverage && pass_evidence?.length) {
    pass_evidence = pass_evidence.map((e, i) =>
      i === 0
        ? { ...e, mutation_or_coverage: input.mutation_or_coverage }
        : e,
    );
  }

  return ReviewIRSchema.parse({
    version: 1,
    session_id: input.session_id,
    verdict: "pass",
    notes: "Mock reviewer: plan + diff + checks look OK for human Accept",
    blocking_issues: [],
    reviewer_model: "mock-reviewer",
    consume_gate: true,
    pass_evidence,
  });
}
