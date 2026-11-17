import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  AcceptanceGateConfigSchema,
  DEFAULT_ACCEPTANCE_GATE_CONFIG,
  type AcceptanceGateConfig,
  type AcceptanceReport,
  type AcceptanceRunSummary,
  type Annotation,
  type Project,
} from "@sightloop/shared";
import {
  createAcceptanceRun,
  getAcceptanceRun,
  getBaseline,
  getLatestAcceptanceRun,
  getProject,
  getSession,
  insertAudit,
  listAcceptanceRuns,
  setSessionAcceptanceCache,
  updateAcceptanceRun,
  upsertBaseline,
  type Database,
} from "@sightloop/db";
import {
  compileScenario,
  resolveArtifactPath,
  runAcceptanceGate,
} from "@sightloop/acceptance-gate";
import type { DaemonConfig } from "./config.js";
import type { SessionWsHub } from "./ws-hub.js";

const gateLocks = new Set<string>();

export function resolveGateConfig(project: Project): AcceptanceGateConfig {
  if (project.acceptance_gate) {
    return AcceptanceGateConfigSchema.parse(project.acceptance_gate);
  }
  const allowed = [
    "http://127.0.0.1:5175",
    "http://localhost:5175",
  ];
  if (project.dev_server_origin) {
    try {
      const u = new URL(project.dev_server_origin);
      allowed.unshift(`${u.protocol}//${u.host}`);
    } catch {
      // ignore
    }
  }
  return AcceptanceGateConfigSchema.parse({
    ...DEFAULT_ACCEPTANCE_GATE_CONFIG,
    allowed_origins: [...new Set(allowed)],
  });
}

export function artifactsRoot(cfg: DaemonConfig): string {
  const root = join(cfg.dbPath, "..");
  // Prefer monorepo data/acceptance-gates next to sqlite when under data/
  const candidate = join(root, "acceptance-gates");
  mkdirSync(candidate, { recursive: true });
  return candidate;
}

export async function runSessionAcceptanceGate(
  cfg: DaemonConfig,
  db: Database,
  hub: SessionWsHub,
  sessionId: string,
  reason: "pre_accept" | "manual" | "post_act" = "manual",
): Promise<AcceptanceRunSummary> {
  const session = getSession(db, sessionId);
  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "not_found" });
  }
  const project = getProject(db, session.project_id);
  if (!project) {
    throw Object.assign(new Error("Project not found"), { code: "not_found" });
  }

  const gateCfg = resolveGateConfig(project);
  if (!gateCfg.enabled) {
    throw Object.assign(new Error("Acceptance gate disabled for project"), {
      code: "gate_disabled",
    });
  }

  if (gateLocks.has(sessionId)) {
    throw Object.assign(new Error("Acceptance gate already running"), {
      code: "gate_busy",
    });
  }

  const annotation = session.annotation as Annotation | null | undefined;
  const compiled = compileScenario({
    session_id: sessionId,
    page_url: session.page_url,
    annotation,
    sniff: session.sniff,
    config: gateCfg,
  });
  if (!compiled.ok) {
    insertAudit(
      db,
      "acceptance_gate_compile_failed",
      { code: compiled.code, message: compiled.message, reason },
      project.id,
      sessionId,
    );
    throw Object.assign(new Error(compiled.message), { code: compiled.code });
  }

  const run = createAcceptanceRun(db, {
    session_id: sessionId,
    project_id: project.id,
    scenario: compiled.scenario,
    start_url: compiled.scenario.start_url,
    temp_commit_sha: session.temp_commit_sha,
    fingerprint: compiled.fingerprint,
  });

  gateLocks.add(sessionId);
  hub.broadcastAcceptanceGate(sessionId, {
    status: "queued",
    run_id: run.id,
  });
  setSessionAcceptanceCache(db, sessionId, run.id, "queued");

  updateAcceptanceRun(db, run.id, {
    status: "running",
    started_at: Date.now(),
  });
  hub.broadcastAcceptanceGate(sessionId, {
    status: "running",
    run_id: run.id,
  });
  setSessionAcceptanceCache(db, sessionId, run.id, "running");

  try {
    const report = await runAcceptanceGate({
      run_id: run.id,
      session_id: sessionId,
      project_id: project.id,
      scenario: compiled.scenario,
      fingerprint: compiled.fingerprint,
      config: gateCfg,
      artifactsRoot: artifactsRoot(cfg),
      temp_commit_sha: session.temp_commit_sha,
      headed: process.env.SIGHTLOOP_GATE_HEADED === "1",
      onProgress: (progress) => {
        hub.broadcastAcceptanceGate(sessionId, {
          status: "running",
          run_id: run.id,
          progress,
        });
      },
    });

    // First-pass auto baseline bookkeeping for screenshots that created baseline
    for (const shot of report.screenshots ?? []) {
      if (shot.baseline_created) {
        upsertBaseline(db, {
          project_id: project.id,
          fingerprint: compiled.fingerprint,
          meta: {
            viewport: compiled.scenario.viewport,
            name: shot.name,
            created_at: Date.now(),
          },
          dir_relpath: `baselines/${project.id}/${compiled.fingerprint}`,
        });
      } else {
        // ensure row exists if baseline file already present
        const existing = getBaseline(db, project.id, compiled.fingerprint);
        if (!existing && shot.passed) {
          upsertBaseline(db, {
            project_id: project.id,
            fingerprint: compiled.fingerprint,
            meta: {
              viewport: compiled.scenario.viewport,
              name: shot.name,
              created_at: Date.now(),
            },
            dir_relpath: `baselines/${project.id}/${compiled.fingerprint}`,
          });
        }
      }
    }

    updateAcceptanceRun(db, run.id, {
      status: report.status === "passed" ? "passed" : report.status === "error" ? "error" : "failed",
      report,
      error: report.error ?? null,
      finished_at: Date.now(),
    });
    setSessionAcceptanceCache(
      db,
      sessionId,
      run.id,
      report.status === "passed" ? "passed" : report.status,
    );

    hub.broadcastAcceptanceGate(sessionId, {
      status: report.status === "passed" ? "passed" : report.status === "error" ? "error" : "failed",
      run_id: run.id,
      report_summary: {
        failed_checks: report.failed_checks,
        failed_steps: report.failed_steps.map((s) => ({
          id: s.id,
          message: s.message,
        })),
        refine_note_draft: report.refine_note_draft,
      },
    });

    insertAudit(
      db,
      "acceptance_gate_finished",
      {
        run_id: run.id,
        status: report.status,
        reason,
        failed_checks: report.failed_checks,
      },
      project.id,
      sessionId,
    );

    return getAcceptanceRun(db, run.id)!;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    updateAcceptanceRun(db, run.id, {
      status: "error",
      error: message,
      finished_at: Date.now(),
      report: {
        run_id: run.id,
        session_id: sessionId,
        status: "error",
        failed_checks: [],
        failed_steps: [],
        console_errors: [],
        network_failures: [],
        screenshots: [],
        error: message,
      } satisfies AcceptanceReport,
    });
    setSessionAcceptanceCache(db, sessionId, run.id, "error");
    hub.broadcastAcceptanceGate(sessionId, {
      status: "error",
      run_id: run.id,
      report_summary: {
        failed_steps: [{ id: "runner", message }],
      },
    });
    throw err;
  } finally {
    gateLocks.delete(sessionId);
  }
}

export function assertAcceptAllowed(
  db: Database,
  project: Project,
  sessionId: string,
  forceAccept?: boolean,
): void {
  const gateCfg = resolveGateConfig(project);
  if (!gateCfg.enabled || !gateCfg.require_pass_to_accept) return;

  if (forceAccept) {
    if (!gateCfg.allow_force_accept) {
      throw Object.assign(
        new Error("force_accept is disabled for this project"),
        { code: "force_accept_denied" },
      );
    }
    insertAudit(
      db,
      "acceptance_gate_force_accept",
      { session_id: sessionId },
      project.id,
      sessionId,
    );
    return;
  }

  const latest = getLatestAcceptanceRun(db, sessionId);
  const session = getSession(db, sessionId);
  if (!latest || latest.status !== "passed") {
    throw Object.assign(
      new Error("Browser acceptance gate did not pass"),
      {
        code: "acceptance_gate_failed",
        details: {
          run_id: latest?.id ?? null,
          status: latest?.status ?? "missing",
          failed_checks: latest?.report?.failed_checks ?? [],
        },
      },
    );
  }

  // Stale if temp_commit_sha changed since gate run
  if (
    session?.temp_commit_sha &&
    latest.temp_commit_sha &&
    session.temp_commit_sha !== latest.temp_commit_sha
  ) {
    throw Object.assign(
      new Error("Acceptance gate is stale — re-run after new temp commit"),
      {
        code: "acceptance_gate_failed",
        details: {
          run_id: latest.id,
          status: "stale",
          failed_checks: [],
        },
      },
    );
  }
}

export function getGateArtifact(
  cfg: DaemonConfig,
  sessionId: string,
  runId: string,
  name: string,
): string | null {
  return resolveArtifactPath(artifactsRoot(cfg), sessionId, runId, name);
}

export { listAcceptanceRuns, getLatestAcceptanceRun, getAcceptanceRun };
