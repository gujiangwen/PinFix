import type { FastifyPluginAsync } from "fastify";
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  apiError,
} from "@sightloop/shared";
import {
  createProject,
  deleteProject,
  getProject,
  insertAudit,
  listProjects,
  updateProject,
  type Database,
} from "@sightloop/db";
import { assertAllowedRepoPath } from "../path-guard.js";
import type { DaemonConfig } from "../config.js";
import { artifactsRoot } from "../acceptance-gate-service.js";
import {
  listAcceptanceArchive,
  replayAcceptanceArchive,
} from "../acceptance-replay.js";

export type ProjectsRouteOpts = {
  db: Database;
  allowedRoots: string[];
  cfg: DaemonConfig;
};

export const projectsRoutes: FastifyPluginAsync<ProjectsRouteOpts> = async (
  app,
  opts,
) => {
  const { db, allowedRoots, cfg } = opts;

  app.get("/v1/projects", async () => {
    return { projects: listProjects(db) };
  });

  app.get<{ Params: { id: string } }>("/v1/projects/:id", async (req, reply) => {
    const project = getProject(db, req.params.id);
    if (!project) {
      return reply
        .code(404)
        .send(apiError("not_found", `Project ${req.params.id} not found`));
    }
    return { project };
  });

  app.post("/v1/projects", async (req, reply) => {
    const parsed = CreateProjectInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          apiError("validation_error", "Invalid project payload", parsed.error.flatten()),
        );
    }

    const check = assertAllowedRepoPath(parsed.data.repo_path, allowedRoots);
    if (!check.ok) {
      insertAudit(db, check.code, {
        repo_path: parsed.data.repo_path,
        message: check.message,
      });
      return reply.code(400).send(apiError(check.code, check.message));
    }

    try {
      const project = createProject(db, {
        ...parsed.data,
        repo_path: check.realPath,
      });
      return reply.code(201).send({ project });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (message.includes("UNIQUE")) {
        return reply
          .code(409)
          .send(
            apiError(
              "duplicate_repo_path",
              "A project with this repo_path already exists",
            ),
          );
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/v1/projects/:id",
    async (req, reply) => {
      const parsed = UpdateProjectInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid project patch",
              parsed.error.flatten(),
            ),
          );
      }

      let repoPath = parsed.data.repo_path;
      if (repoPath !== undefined) {
        const check = assertAllowedRepoPath(repoPath, allowedRoots);
        if (!check.ok) {
          insertAudit(db, check.code, {
            repo_path: repoPath,
            message: check.message,
            project_id: req.params.id,
          });
          return reply.code(400).send(apiError(check.code, check.message));
        }
        repoPath = check.realPath;
      }

      try {
        const project = updateProject(db, req.params.id, {
          ...parsed.data,
          ...(repoPath !== undefined ? { repo_path: repoPath } : {}),
        });
        if (!project) {
          return reply
            .code(404)
            .send(apiError("not_found", `Project ${req.params.id} not found`));
        }
        return { project };
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        if (message.includes("UNIQUE")) {
          return reply
            .code(409)
            .send(
              apiError(
                "duplicate_repo_path",
                "A project with this repo_path already exists",
              ),
            );
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/projects/:id",
    async (req, reply) => {
      const ok = deleteProject(db, req.params.id);
      if (!ok) {
        return reply
          .code(404)
          .send(apiError("not_found", `Project ${req.params.id} not found`));
      }
      return reply.code(204).send();
    },
  );

  /** M11c: list archived acceptance scenarios under project.repo_path/acceptance. */
  app.get<{ Params: { id: string } }>(
    "/v1/projects/:id/acceptance",
    async (req, reply) => {
      const project = getProject(db, req.params.id);
      if (!project) {
        return reply
          .code(404)
          .send(apiError("not_found", `Project ${req.params.id} not found`));
      }
      const entries = listAcceptanceArchive(project.repo_path);
      return { project_id: project.id, entries };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { ids?: string[]; fingerprints?: string[]; all?: boolean };
  }>("/v1/projects/:id/acceptance/replay", async (req, reply) => {
    const project = getProject(db, req.params.id);
    if (!project) {
      return reply
        .code(404)
        .send(apiError("not_found", `Project ${req.params.id} not found`));
    }
    const body = req.body ?? {};
    const fingerprints = body.fingerprints ?? body.ids ?? [];
    const all = Boolean(body.all) || fingerprints.length === 0;
    try {
      const { results } = await replayAcceptanceArchive({
        repoPath: project.repo_path,
        projectId: project.id,
        fingerprints,
        all,
        artifactsRoot: artifactsRoot(cfg),
      });
      insertAudit(
        db,
        "acceptance_replay",
        {
          count: results.length,
          passed: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
        project.id,
      );
      return { project_id: project.id, results };
    } catch (err) {
      return reply
        .code(500)
        .send(apiError("replay_failed", (err as Error).message));
    }
  });
};
