import type { ReviewIR } from "@sightloop/shared";
import { ReviewIRSchema } from "@sightloop/shared";

export function crossJudgeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.SIGHTLOOP_CROSS_JUDGE === "1" || env.SIGHTLOOP_CROSS_JUDGE === "true"
  );
}

export type JudgeMergeResult = {
  review: ReviewIR;
  judge: ReviewIR | null;
  skipped: boolean;
  skip_reason?: string;
  agreed: boolean;
};

/**
 * Merge primary Reviewer + independent Judge.
 * Agree Pass → Pass; any refine or disagreement → refine with merged issues.
 */
export function mergeCrossJudge(opts: {
  primary: ReviewIR;
  judge: ReviewIR | null;
  skipped?: boolean;
  skip_reason?: string;
}): JudgeMergeResult {
  if (opts.skipped || !opts.judge) {
    return {
      review: opts.primary,
      judge: null,
      skipped: true,
      skip_reason: opts.skip_reason ?? "judge_unavailable",
      agreed: true,
    };
  }
  const judge = opts.judge;
  const agreed =
    opts.primary.verdict === judge.verdict &&
    !(opts.primary.verdict === "pass" && judge.verdict !== "pass");

  if (opts.primary.verdict === "pass" && judge.verdict === "pass" && agreed) {
    return {
      review: opts.primary,
      judge,
      skipped: false,
      agreed: true,
    };
  }

  const blocking = [
    ...(opts.primary.blocking_issues ?? []),
    ...(judge.blocking_issues ?? []),
  ];
  if (opts.primary.verdict !== judge.verdict) {
    blocking.push({
      code: "other",
      message: `Cross-judge disagreement: primary=${opts.primary.verdict} judge=${judge.verdict}`,
    });
  }

  const review = ReviewIRSchema.parse({
    version: 1,
    session_id: opts.primary.session_id,
    verdict: "refine",
    notes: `Cross-judge: primary=${opts.primary.verdict} judge=${judge.verdict}. ${opts.primary.notes}`,
    blocking_issues: blocking.slice(0, 20),
    suggested_allowed_files: opts.primary.suggested_allowed_files,
    implement_only: opts.primary.implement_only,
    consume_gate: opts.primary.consume_gate ?? true,
    reviewer_model: opts.primary.reviewer_model,
    pass_evidence: undefined,
  });

  return { review, judge, skipped: false, agreed: false };
}

/** Mock second-opinion judge — can flip to refine for smoke. */
export function mockJudge(opts: {
  session_id: string;
  primary: ReviewIR;
  force_disagree?: boolean;
}): ReviewIR {
  if (opts.force_disagree && opts.primary.verdict === "pass") {
    return ReviewIRSchema.parse({
      version: 1,
      session_id: opts.session_id,
      verdict: "refine",
      notes: "Mock judge disagrees with primary Pass",
      blocking_issues: [
        {
          code: "other",
          message: "Mock cross-judge forced disagreement",
        },
      ],
      reviewer_model: "mock-judge",
      consume_gate: true,
    });
  }
  return ReviewIRSchema.parse({
    ...opts.primary,
    reviewer_model: "mock-judge",
    notes: `Judge agrees: ${opts.primary.notes}`.slice(0, 4000),
  });
}
