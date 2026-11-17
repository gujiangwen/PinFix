import { existsSync, readFileSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAcceptanceGate } from "@sightloop/acceptance-gate";
import type { AcceptanceGateConfig, ScenarioIR } from "@sightloop/shared";
import {
  AcceptanceGateConfigSchema,
  DEFAULT_ACCEPTANCE_GATE_CONFIG,
} from "@sightloop/shared";

export type AcceptanceListItem = {
  fingerprint: string;
  scenario_rel: string;
  baselines_rel: string;
  accepted_at?: number;
  start_url?: string | null;
};

export function listAcceptanceArchive(repoPath: string): AcceptanceListItem[] {
  const root = join(repoPath, "acceptance");
  const manifestPath = join(root, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        entries?: AcceptanceListItem[];
      };
      return m.entries ?? [];
    } catch {
      // fall through
    }
  }
  const scenariosDir = join(root, "scenarios");
  if (!existsSync(scenariosDir)) return [];
  return readdirSync(scenariosDir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      const fp = n.replace(/\.json$/, "");
      return {
        fingerprint: fp,
        scenario_rel: `scenarios/${n}`,
        baselines_rel: `baselines/${fp}`,
      };
    });
}

export type ReplayResult = {
  fingerprint: string;
  ok: boolean;
  status: string;
  detail: string;
};

/**
 * Replay archived Scenario IR + baselines via Playwright gate runner.
 * Copies archived baselines into a temp artifacts tree so compare finds them.
 */
export async function replayAcceptanceArchive(opts: {
  repoPath: string;
  projectId: string;
  fingerprints?: string[];
  all?: boolean;
  artifactsRoot: string;
  gateConfig?: AcceptanceGateConfig;
}): Promise<{ results: ReplayResult[] }> {
  const listed = listAcceptanceArchive(opts.repoPath);
  const selected = opts.all
    ? listed
    : listed.filter((e) =>
        (opts.fingerprints ?? []).includes(e.fingerprint),
      );
  const cfg = AcceptanceGateConfigSchema.parse(
    opts.gateConfig ?? {
      ...DEFAULT_ACCEPTANCE_GATE_CONFIG,
      enabled: true,
      require_pass_to_accept: false,
      auto_run_on_awaiting_review: false,
    },
  );

  const results: ReplayResult[] = [];
  for (const entry of selected) {
    const scenarioPath = join(opts.repoPath, "acceptance", entry.scenario_rel);
    if (!existsSync(scenarioPath)) {
      results.push({
        fingerprint: entry.fingerprint,
        ok: false,
        status: "error",
        detail: "scenario missing",
      });
      continue;
    }
    let scenario: ScenarioIR;
    let startUrl: string;
    try {
      const raw = JSON.parse(readFileSync(scenarioPath, "utf8")) as {
        scenario: ScenarioIR;
        start_url?: string;
      };
      scenario = raw.scenario;
      startUrl = raw.start_url ?? scenario.start_url;
    } catch (err) {
      results.push({
        fingerprint: entry.fingerprint,
        ok: false,
        status: "error",
        detail: (err as Error).message,
      });
      continue;
    }

    // Stage baselines into artifactsRoot/baselines/<project>/<fp>/
    const srcBase = join(opts.repoPath, "acceptance", entry.baselines_rel);
    const dstBase = join(
      opts.artifactsRoot,
      "baselines",
      opts.projectId,
      entry.fingerprint,
    );
    mkdirSync(dstBase, { recursive: true });
    if (existsSync(srcBase)) {
      for (const name of readdirSync(srcBase)) {
        if (!name.endsWith(".png")) continue;
        copyFileSync(join(srcBase, name), join(dstBase, name));
      }
    }

    try {
      const report = await runAcceptanceGate({
        run_id: `replay-${entry.fingerprint}`,
        session_id: `replay-${entry.fingerprint}`,
        project_id: opts.projectId,
        scenario,
        fingerprint: entry.fingerprint,
        config: cfg,
        artifactsRoot: opts.artifactsRoot,
        temp_commit_sha: null,
      });
      results.push({
        fingerprint: entry.fingerprint,
        ok: report.status === "passed",
        status: report.status,
        detail: report.error ?? `replay ${report.status}`,
      });
    } catch (err) {
      results.push({
        fingerprint: entry.fingerprint,
        ok: false,
        status: "error",
        detail: (err as Error).message,
      });
    }
  }
  return { results };
}
