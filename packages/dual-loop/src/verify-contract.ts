import { runVerifyCmd } from "@sightloop/agent-runtime";
import type { PlanIR, VerifyContract } from "@sightloop/shared";

export type ContractRunResult = {
  ok: boolean;
  results: Record<string, { ok: boolean; summary: string; excerpt?: string }>;
  failures: Array<{ id: string; summary: string; excerpt?: string }>;
};

/**
 * Run PlanIR.verify_contract.shell items. Scenario refs are validated against
 * gate_status by the caller (reuse AcceptanceGate).
 */
export function runVerifyContractShell(
  repoPath: string,
  contract: VerifyContract | undefined | null,
): ContractRunResult {
  const results: ContractRunResult["results"] = {};
  const failures: ContractRunResult["failures"] = [];
  if (!contract) {
    return {
      ok: false,
      results: {},
      failures: [
        {
          id: "contract:missing",
          summary: "PlanIR.verify_contract missing",
        },
      ],
    };
  }

  for (const item of contract.shell) {
    const expect = item.expect_exit ?? 0;
    const r = runVerifyCmd(repoPath, item.cmd);
    // runVerifyCmd only exposes ok boolean; treat ok as exit 0.
    const ok = expect === 0 ? r.ok : r.ok === (expect === 0);
    const summary = ok
      ? `ok (expect_exit=${expect})`
      : `failed (expect_exit=${expect})`;
    results[item.id] = {
      ok,
      summary,
      excerpt: r.output?.slice(-1500),
    };
    if (!ok) {
      failures.push({
        id: item.id,
        summary: `verify_contract shell ${item.id}: ${summary}`,
        excerpt: r.output?.slice(-1500),
      });
    }
  }

  return {
    ok: failures.length === 0,
    results,
    failures,
  };
}

export function contractUnmetMark(plan: PlanIR | null): string {
  return plan?.verify_contract
    ? "verify_contract_unmet"
    : "verify_contract_missing";
}
