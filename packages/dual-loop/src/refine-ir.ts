import {
  RefineIRSchema,
  type RefineIR,
  type ReviewIR,
} from "@sightloop/shared";

export function refineFromShellFailure(opts: {
  session_id: string;
  cmd?: string | null;
  output?: string | null;
  plan_id?: string;
}): RefineIR {
  const excerpt = (opts.output ?? "").slice(-2000);
  return RefineIRSchema.parse({
    version: 1,
    source: "shell_verify",
    session_id: opts.session_id,
    plan_id: opts.plan_id,
    blocking_issues: [
      {
        id: "shell:verify_cmd",
        severity: "blocker",
        summary: `Shell verify failed${opts.cmd ? `: ${opts.cmd}` : ""}`,
        evidence: {
          kind: "shell",
          expected: "exit 0",
          actual: "non-zero or failed",
          excerpt: excerpt || undefined,
        },
      },
    ],
    created_at: Date.now(),
  });
}

export function refineFromGateFailure(opts: {
  session_id: string;
  gate_status: string;
  report?: unknown;
  plan_id?: string;
}): RefineIR {
  const issues: RefineIR["blocking_issues"] = [];
  const report = opts.report as {
    failed_checks?: string[];
    failed_steps?: Array<{ id?: string; message?: string }>;
  } | null;

  for (const step of report?.failed_steps ?? []) {
    const id = `gate:assert:${step.id ?? issues.length}`;
    issues.push({
      id,
      severity: "blocker",
      summary: step.message ?? `Gate step failed (${step.id ?? "?"})`,
      evidence: {
        kind: "playwright",
        assertion_id: step.id,
        actual: step.message,
      },
    });
  }
  for (const check of report?.failed_checks ?? []) {
    issues.push({
      id: `gate:check:${check}`,
      severity: check === "console" || check === "network" ? "major" : "blocker",
      summary: `Acceptance gate check failed: ${check}`,
      evidence: {
        kind:
          check === "console"
            ? "console"
            : check === "network"
              ? "network"
              : "playwright",
        assertion_id: check,
      },
    });
  }
  if (!issues.length) {
    issues.push({
      id: `gate:status:${opts.gate_status}`,
      severity: "blocker",
      summary: `Acceptance gate status=${opts.gate_status}`,
      evidence: { kind: "playwright", actual: opts.gate_status },
    });
  }
  return RefineIRSchema.parse({
    version: 1,
    source: "acceptance_gate",
    session_id: opts.session_id,
    plan_id: opts.plan_id,
    blocking_issues: issues.slice(0, 40),
    created_at: Date.now(),
  });
}

export function refineFromReviewer(opts: {
  session_id: string;
  review: ReviewIR;
  plan_id?: string;
}): RefineIR {
  const issues =
    opts.review.blocking_issues?.length > 0
      ? opts.review.blocking_issues.map((b, i) => ({
          id: `reviewer:${b.code}:${i}`,
          severity: (b.code === "verify_failed" || b.code === "gate_failed"
            ? "blocker"
            : "major") as "blocker" | "major" | "minor",
          summary: b.message,
          evidence: {
            kind: "text" as const,
            excerpt: b.message.slice(0, 500),
          },
        }))
      : [
          {
            id: "reviewer:other:0",
            severity: "major" as const,
            summary: opts.review.notes || "Reviewer requested refine",
            evidence: {
              kind: "text" as const,
              excerpt: (opts.review.notes || "refine").slice(0, 500),
            },
          },
        ];

  return RefineIRSchema.parse({
    version: 1,
    source: "reviewer",
    session_id: opts.session_id,
    plan_id: opts.plan_id,
    blocking_issues: issues,
    suggested_file_delta: opts.review.suggested_allowed_files
      ? { add: opts.review.suggested_allowed_files }
      : undefined,
    notes: opts.review.notes,
    created_at: Date.now(),
  });
}

export function refineFromWhitelistBlock(opts: {
  session_id: string;
  path: string;
  message: string;
  plan_id?: string;
}): RefineIR {
  return RefineIRSchema.parse({
    version: 1,
    source: "implementer_blocked",
    session_id: opts.session_id,
    plan_id: opts.plan_id,
    blocking_issues: [
      {
        id: `whitelist:${opts.path}`,
        severity: "blocker",
        summary: opts.message,
        evidence: {
          kind: "diff",
          file: opts.path,
          actual: opts.message.slice(0, 500),
        },
        related_files: [opts.path],
      },
    ],
    created_at: Date.now(),
  });
}

export function refineFromContractFailure(opts: {
  session_id: string;
  failures: Array<{ id: string; summary: string; excerpt?: string }>;
  plan_id?: string;
}): RefineIR {
  return RefineIRSchema.parse({
    version: 1,
    source: "verify_contract",
    session_id: opts.session_id,
    plan_id: opts.plan_id,
    blocking_issues: opts.failures.map((f) => ({
      id: f.id,
      severity: "blocker" as const,
      summary: f.summary,
      evidence: {
        kind: "shell" as const,
        assertion_id: f.id,
        excerpt: f.excerpt?.slice(0, 2000),
      },
    })),
    created_at: Date.now(),
  });
}
