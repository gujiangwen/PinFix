import type { FastifyPluginAsync } from "fastify";
import { apiError } from "@sightloop/shared";
import {
  consumeCheckpoint,
  createCheckpoint,
  gcCheckpoints,
  getCheckpoint,
  getProject,
  getSession,
  getSessionPlan,
  insertAudit,
  listCheckpoints,
  resumeCheckpoint,
  DEFAULT_CHECKPOINT_MAX_PER_SESSION,
  type Database,
} from "@sightloop/db";
import type { DaemonConfig } from "../config.js";

export type CheckpointRouteOpts = {
  db: Database;
  cfg: DaemonConfig;
};

/**
 * M12d checkpoints + R4 GC + R8 bind checks.
 * Resume restores WIP/issue set for the same project+repo only.
 */
export const checkpointRoutes: FastifyPluginAsync<CheckpointRouteOpts> = async (
  app,
  opts,
) => {
  const { db, cfg } = opts;
  const maxPerSession =
    cfg.checkpointMaxPerSession ?? DEFAULT_CHECKPOINT_MAX_PER_SESSION;

  app.get<{
    Querystring: {
      session_id?: string;
      project_id?: string;
      limit?: string;
      offset?: string;
    };
  }>("/v1/checkpoints", async (req) => {
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit ?? "50", 10) || 50),
    );
    const offset = Math.max(0, Number.parseInt(req.query.offset ?? "0", 10) || 0);
    const checkpoints = listCheckpoints(db, {
      session_id: req.query.session_id,
      project_id: req.query.project_id,
      limit,
      offset,
    });
    return { checkpoints, limit, offset };
  });

  app.post<{
    Body: {
      session_id: string;
      issue_ids?: string[];
      note?: string;
    };
  }>("/v1/checkpoints", async (req, reply) => {
    const sessionId = req.body?.session_id;
    if (!sessionId) {
      return reply.code(400).send(apiError("bad_request", "session_id required"));
    }
    const session = getSession(db, sessionId);
    if (!session) {
      return reply.code(404).send(apiError("not_found", "session not found"));
    }
    const project = getProject(db, session.project_id);
    if (!project) {
      return reply.code(404).send(apiError("not_found", "project not found"));
    }
    const plan = getSessionPlan(db, sessionId);
    const issue_ids =
      req.body.issue_ids ??
      (plan &&
      Array.isArray(
        (plan as { issue_resolutions?: unknown }).issue_resolutions,
      )
        ? (
            (
              plan as {
                issue_resolutions: Array<{
                  issue_id: string;
                  status: string;
                }>;
              }
            ).issue_resolutions ?? []
          )
            .filter((r) => r.status === "defer" || r.status === "reopen")
            .map((r) => r.issue_id)
        : []);

    const cp = createCheckpoint(db, {
      session_id: sessionId,
      project_id: project.id,
      repo_path: project.repo_path,
      issue_ids,
      plan_json: plan,
      refine_ir: null,
      wip_commit: session.temp_commit_sha,
      graph_state: {
        status: session.status,
        step_count: session.step_count,
        agent_judge_pass: false,
      },
      note: req.body.note ?? null,
      max_per_session: maxPerSession,
    });
    insertAudit(
      db,
      "checkpoint_suspended",
      { id: cp.id, issue_ids: cp.issue_ids },
      project.id,
      sessionId,
    );
    return { checkpoint: cp };
  });

  app.post<{ Params: { id: string }; Body?: { session_id?: string } }>(
    "/v1/checkpoints/:id/resume",
    async (req, reply) => {
      const cp = getCheckpoint(db, req.params.id);
      if (!cp) {
        return reply.code(404).send(apiError("not_found", "checkpoint not found"));
      }
      const sessionId = req.body?.session_id ?? cp.session_id;
      const session = getSession(db, sessionId);
      if (!session) {
        return reply.code(404).send(apiError("not_found", "session not found"));
      }
      const project = getProject(db, session.project_id);
      if (!project) {
        return reply.code(404).send(apiError("not_found", "project not found"));
      }
      const result = resumeCheckpoint(db, cp.id, {
        project_id: project.id,
        repo_path: project.repo_path,
      });
      if (!result.ok) {
        if (result.code === "bind_mismatch") {
          return reply.code(409).send(
            apiError(
              "checkpoint_bind_mismatch",
              "checkpoint project_id/repo_path does not match session project",
            ),
          );
        }
        if (result.code === "not_suspended") {
          return reply
            .code(409)
            .send(apiError("invalid_status", `checkpoint status=${cp.status}`));
        }
        return reply.code(404).send(apiError("not_found", "checkpoint not found"));
      }
      insertAudit(
        db,
        "checkpoint_resumed",
        {
          id: cp.id,
          issue_ids: result.checkpoint.issue_ids,
          wip_commit: result.checkpoint.wip_commit,
        },
        project.id,
        sessionId,
      );
      return {
        checkpoint: result.checkpoint,
        resume: {
          issue_ids: result.checkpoint.issue_ids,
          wip_commit: result.checkpoint.wip_commit,
          plan: result.checkpoint.plan_json,
          refine_ir: result.checkpoint.refine_ir,
        },
      };
    },
  );

  app.post<{
    Body?: {
      session_id?: string;
      project_id?: string;
      consumed?: boolean;
      max_age_ms?: number;
    };
  }>("/v1/checkpoints/gc", async (req) => {
    const body = req.body ?? {};
    const deleted = gcCheckpoints(db, {
      session_id: body.session_id,
      project_id: body.project_id,
      consumed: body.consumed,
      max_age_ms: body.max_age_ms,
    });
    insertAudit(
      db,
      "checkpoint_gc",
      { deleted },
      body.project_id ?? null,
      body.session_id ?? null,
    );
    return { deleted };
  });

  app.post<{ Params: { id: string } }>(
    "/v1/checkpoints/:id/consume",
    async (req, reply) => {
      const cp = consumeCheckpoint(db, req.params.id);
      if (!cp) {
        return reply
          .code(404)
          .send(apiError("not_found", "checkpoint not found"));
      }
      return { checkpoint: cp };
    },
  );
};
