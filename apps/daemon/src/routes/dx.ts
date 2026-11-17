import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import {
  DxEnsureFixtureInputSchema,
  apiError,
  type DxStatus,
} from "@sightloop/shared";
import {
  createProject,
  insertAudit,
  listProjects,
  type Database,
} from "@sightloop/db";
import { ensureGitRepo } from "@sightloop/agent-runtime";
import type { DaemonConfig } from "../config.js";
import { assertAllowedRepoPath } from "../path-guard.js";
import { getRunnerStatus } from "../runner-status.js";
import { probeGithubHealth } from "../github-health.js";

export type DxRouteOpts = {
  db: Database;
  cfg: DaemonConfig;
};

const FIXTURE_ORIGIN = "http://localhost:5175/*";
const FIXTURE_NAME = "fixture-react";

function tokenPreview(token: string): string {
  if (token.length <= 4) return "****";
  return `…${token.slice(-4)}`;
}

function findFixtureProject(db: Database) {
  const projects = listProjects(db);
  return (
    projects.find((p) => p.origin_pattern === FIXTURE_ORIGIN) ??
    projects.find((p) => p.name === FIXTURE_NAME) ??
    null
  );
}

function pickFixtureRepoPath(
  cfg: DaemonConfig,
  override?: string,
): { path: string; hint: string } {
  if (override) {
    return {
      path: resolve(override),
      hint: "Using caller-supplied repo_path",
    };
  }

  // Agent edits go to a sandbox under allowed roots (never dirty the Vite fixture tree).
  // Extension still matches pages via origin_pattern http://localhost:5175/*.
  const root = cfg.allowedRoots[0] ?? "/tmp";
  const sandbox = join(root, "sightloop-dx-fixture");
  return {
    path: sandbox,
    hint:
      "Demo project repo_path is a sandbox under allowed roots. Run `pnpm dev:fixture` and open http://localhost:5175 to pick.",
  };
}

function ensureSandboxRepo(repoPath: string): void {
  mkdirSync(join(repoPath, "src"), { recursive: true });
  if (!existsSync(join(repoPath, "README.md"))) {
    writeFileSync(
      join(repoPath, "README.md"),
      "# SightLoop DX fixture sandbox\n\nCreated by POST /v1/dx/ensure-fixture-project.\n",
      "utf8",
    );
  }
  if (!existsSync(join(repoPath, "src", "app.ts"))) {
    writeFileSync(
      join(repoPath, "src", "app.ts"),
      "export const sightloopDxFixture = true;\n",
      "utf8",
    );
  }
  ensureGitRepo(repoPath);
}

export const dxRoutes: FastifyPluginAsync<DxRouteOpts> = async (app, opts) => {
  const { db, cfg } = opts;

  app.get("/v1/dx/status", async () => {
    const runner = getRunnerStatus(process.env);
    const projects = listProjects(db);
    const fixture = findFixtureProject(db);
    const status: DxStatus = {
      daemon: {
        ok: true,
        version: cfg.version,
        bind: `${cfg.host}:${cfg.port}`,
        label: cfg.dxLabel,
      },
      auth: {
        token_required: true,
        token_configured: Boolean(cfg.token),
        dx_bootstrap_enabled: cfg.dxBootstrap,
        token_preview: cfg.dxBootstrap ? tokenPreview(cfg.token) : null,
      },
      runner,
      projects: {
        count: projects.length,
        fixture_project_id: fixture?.id ?? null,
      },
      paths: {
        allowed_roots_configured: cfg.allowedRoots.length > 0,
        data_dir: resolve(cfg.dbPath, ".."),
        fixture_repo_path: fixture?.repo_path ?? null,
      },
      dual_loop: {
        enabled: cfg.dualLoop,
        mode: cfg.dualLoopMock ? "mock" : "llm",
        max_inner_refines: cfg.maxInnerRefines,
        planner_model: cfg.plannerModel,
        implementer_model: cfg.implementerModel,
        reviewer_model: cfg.reviewerModel,
        planner_backend:
          !cfg.dualLoopMock && cfg.plannerKeyConfigured ? "llm" : "mock",
        reviewer_backend:
          !cfg.dualLoopMock && cfg.reviewerKeyConfigured ? "llm" : "mock",
        planner_key_configured: cfg.plannerKeyConfigured,
        reviewer_key_configured: cfg.reviewerKeyConfigured,
        fallback_reason:
          !cfg.dualLoopMock && !cfg.plannerKeyConfigured
            ? "no_planner_api_key"
            : null,
        cross_judge: cfg.crossJudge,
        judge_key_configured: cfg.judgeKeyConfigured,
        mutation_gate: cfg.mutationGate,
      },
      github: probeGithubHealth(),
    };
    return status;
  });

  app.post("/v1/dx/github-probe", async () => {
    return { github: probeGithubHealth(true) };
  });

  app.post("/v1/dx/bootstrap", async (_req, reply) => {
    if (!cfg.dxBootstrap) {
      return reply
        .code(403)
        .send(
          apiError(
            "dx_bootstrap_disabled",
            "Set SIGHTLOOP_DX_BOOTSTRAP=1 for local DX token bootstrap (loopback only)",
          ),
        );
    }
    return {
      ok: true,
      dx_bootstrap_enabled: true,
      token_configured: true,
      token_preview: tokenPreview(cfg.token),
      token: cfg.token,
      daemon_url: `http://${cfg.host}:${cfg.port}`,
      hint: "Token returned only because DX bootstrap is enabled on loopback. Disable on shared machines.",
    };
  });

  app.post("/v1/dx/ensure-fixture-project", async (req, reply) => {
    const parsed = DxEnsureFixtureInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          apiError(
            "validation_error",
            "Invalid ensure-fixture payload",
            parsed.error.flatten(),
          ),
        );
    }

    const existing = findFixtureProject(db);
    if (existing && !parsed.data.repo_path) {
      return {
        project_id: existing.id,
        created: false,
        project: {
          id: existing.id,
          name: existing.name,
          repo_path: existing.repo_path,
          origin_pattern: existing.origin_pattern,
          mode: existing.mode,
        },
        fixture_hint:
          "Fixture project already registered — open http://localhost:5175 after `pnpm dev:fixture`",
      };
    }

    const picked = pickFixtureRepoPath(cfg, parsed.data.repo_path);
    const check = assertAllowedRepoPath(picked.path, cfg.allowedRoots, {
      createIfMissing: true,
    });
    if (!check.ok) {
      insertAudit(db, check.code, {
        repo_path: picked.path,
        message: check.message,
        source: "dx_ensure_fixture",
      });
      return reply.code(400).send(apiError(check.code, check.message));
    }

    ensureSandboxRepo(check.realPath);

    // Idempotent: same repo_path already registered?
    const byPath = listProjects(db).find((p) => p.repo_path === check.realPath);
    if (byPath) {
      return {
        project_id: byPath.id,
        created: false,
        project: {
          id: byPath.id,
          name: byPath.name,
          repo_path: byPath.repo_path,
          origin_pattern: byPath.origin_pattern,
          mode: byPath.mode,
        },
        fixture_hint: picked.hint,
      };
    }

    try {
      const project = createProject(db, {
        name: parsed.data.name ?? FIXTURE_NAME,
        repo_path: check.realPath,
        origin_pattern: parsed.data.origin_pattern ?? FIXTURE_ORIGIN,
        file_whitelist: ["src/**", "AGENTS.md", "*.tsx", "*.ts", "*.css"],
        mode: parsed.data.mode ?? "hmr",
        default_branch: "main",
        verify_cmd: null,
      });
      insertAudit(
        db,
        "dx_fixture_ensured",
        { project_id: project.id, repo_path: project.repo_path },
        project.id,
        null,
      );
      return reply.code(201).send({
        project_id: project.id,
        created: true,
        project: {
          id: project.id,
          name: project.name,
          repo_path: project.repo_path,
          origin_pattern: project.origin_pattern,
          mode: project.mode,
        },
        fixture_hint: picked.hint,
      });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (message.includes("UNIQUE")) {
        const again = listProjects(db).find(
          (p) => p.repo_path === check.realPath,
        );
        if (again) {
          return {
            project_id: again.id,
            created: false,
            project: {
              id: again.id,
              name: again.name,
              repo_path: again.repo_path,
              origin_pattern: again.origin_pattern,
              mode: again.mode,
            },
            fixture_hint: picked.hint,
          };
        }
      }
      throw err;
    }
  });
};
