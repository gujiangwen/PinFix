/**
 * M12c — lightweight mutation/coverage proxy (default off via SIGHTLOOP_MUTATION_GATE).
 */

export type MutationOrCoverage = {
  score: number;
  threshold: number;
  met: boolean;
  detail?: string;
};

export function mutationGateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.SIGHTLOOP_MUTATION_GATE === "1" ||
    env.SIGHTLOOP_MUTATION_GATE === "true"
  );
}

/**
 * Proxy oracle: score from contract pass ratio + optional test_first presence.
 * Not a real mutation framework — intentional lightweight stand-in.
 */
export function evaluateMutationProxy(opts: {
  contract_results?: Record<string, { ok: boolean; summary: string }>;
  test_first_paths?: string[];
  threshold?: number;
}): MutationOrCoverage {
  const threshold = opts.threshold ?? 0.7;
  const results = Object.values(opts.contract_results ?? {});
  const passRatio = results.length
    ? results.filter((r) => r.ok).length / results.length
    : 0.5;
  const testBoost = (opts.test_first_paths?.length ?? 0) > 0 ? 0.25 : 0;
  const score = Math.min(1, passRatio + testBoost);
  return {
    score: Number(score.toFixed(3)),
    threshold,
    met: score >= threshold,
    detail: `proxy pass_ratio=${passRatio.toFixed(2)} test_boost=${testBoost}`,
  };
}
