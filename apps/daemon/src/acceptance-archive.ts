import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AcceptanceReport } from "@sightloop/shared";

export type ArchiveInput = {
  repoPath: string;
  projectId: string;
  sessionId: string;
  fingerprint: string;
  scenario: unknown;
  startUrl?: string | null;
  /** Daemon-side baselines root (acceptance-gates/baselines). */
  baselinesRoot: string;
  report?: AcceptanceReport | null;
};

export type ArchiveResult = {
  ok: boolean;
  path: string | null;
  detail: string;
};

type Manifest = {
  version: 1;
  updated_at: number;
  entries: Array<{
    fingerprint: string;
    session_id: string;
    project_id: string;
    scenario_rel: string;
    baselines_rel: string;
    accepted_at: number;
  }>;
};

/**
 * Copy Scenario IR + screenshot baselines into `<repo>/acceptance/` for CI/local replay.
 */
export function archiveAcceptanceToRepo(input: ArchiveInput): ArchiveResult {
  const root = join(input.repoPath, "acceptance");
  const scenariosDir = join(root, "scenarios");
  const baselinesDir = join(root, "baselines", input.fingerprint);
  mkdirSync(scenariosDir, { recursive: true });
  mkdirSync(baselinesDir, { recursive: true });

  const scenarioRel = `scenarios/${input.fingerprint}.json`;
  const scenarioPath = join(root, scenarioRel);
  const payload = {
    version: 1,
    fingerprint: input.fingerprint,
    session_id: input.sessionId,
    project_id: input.projectId,
    start_url: input.startUrl ?? null,
    accepted_at: Date.now(),
    scenario: input.scenario,
    report_status: input.report?.status ?? null,
  };
  writeFileSync(scenarioPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const srcBaselines = join(
    input.baselinesRoot,
    input.projectId,
    input.fingerprint,
  );
  let copied = 0;
  if (existsSync(srcBaselines)) {
    for (const name of readdirSync(srcBaselines)) {
      if (!name.endsWith(".png")) continue;
      copyFileSync(join(srcBaselines, name), join(baselinesDir, name));
      copied += 1;
    }
  }

  const readme = join(root, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `# SightLoop acceptance archive

Written on Human **Accept** (M10c).

- \`scenarios/<fingerprint>.json\` — Scenario IR + session meta
- \`baselines/<fingerprint>/*.png\` — screenshot baselines
- \`manifest.json\` — index of archived scenarios

Replay locally by pointing the Playwright gate at these artifacts (CI wiring later).
`,
      "utf8",
    );
  }

  const manifestPath = join(root, "manifest.json");
  let manifest: Manifest = { version: 1, updated_at: Date.now(), entries: [] };
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
      if (!Array.isArray(manifest.entries)) manifest.entries = [];
    } catch {
      manifest = { version: 1, updated_at: Date.now(), entries: [] };
    }
  }
  manifest.entries = manifest.entries.filter(
    (e) => e.fingerprint !== input.fingerprint,
  );
  manifest.entries.unshift({
    fingerprint: input.fingerprint,
    session_id: input.sessionId,
    project_id: input.projectId,
    scenario_rel: scenarioRel,
    baselines_rel: `baselines/${input.fingerprint}`,
    accepted_at: Date.now(),
  });
  manifest.updated_at = Date.now();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return {
    ok: true,
    path: scenarioRel,
    detail: `archived scenario + ${copied} baseline png(s)`,
  };
}
