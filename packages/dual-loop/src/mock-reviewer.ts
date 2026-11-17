import { ReviewIRSchema, type ReviewIR } from "@sightloop/shared";

export type MockReviewerInput = {
  session_id: string;
  shell_ok?: boolean;
  gate_status?: string | null;
  /** Force refine once for smoke (e.g. when inner_refine_count === 0). */
  force_refine_once?: boolean;
  inner_refine_count?: number;
  files_touched?: string[];
  plan_allowed_files?: string[];
};

/**
 * Mock reviewer: shell/gate failure → refine; else pass.
 * Optional force_refine_once when inner_refine_count === 0 for smoke topology.
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

  // Flag writes outside plan (should already be blocked; defensive).
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

  return ReviewIRSchema.parse({
    version: 1,
    session_id: input.session_id,
    verdict: "pass",
    notes: "Mock reviewer: plan + diff + checks look OK for human Accept",
    blocking_issues: [],
    reviewer_model: "mock-reviewer",
    consume_gate: true,
  });
}
