import type { FastifyPluginAsync } from "fastify";
import {
  CreateSessionInputSchema,
  ReviewInputSchema,
  apiError,
} from "@sightloop/shared";
import {
  createSession,
  getProject,
  getSession,
  listSessions,
  listAgentSteps,
  listReviews,
  type Database,
} from "@sightloop/db";
import type { SessionWsHub } from "../ws-hub.js";
import type { DaemonConfig } from "../config.js";
import {
  startSessionLoop,
  reviewSession,
  getSessionDiff,
  writeSessionMarkup,
} from "../loop-service.js";

export type SessionsRouteOpts = {
  db: Database;
  hub: SessionWsHub;
  cfg: DaemonConfig;
};

export const sessionsRoutes: FastifyPluginAsync<SessionsRouteOpts> = async (
  app,
  opts,
) => {
  const { db, hub, cfg } = opts;

  app.get<{ Querystring: { project_id?: string } }>(
    "/v1/sessions",
    async (req) => {
      const sessions = listSessions(db, req.query.project_id);
      return { sessions };
    },
  );

  app.get<{ Params: { id: string } }>("/v1/sessions/:id", async (req, reply) => {
    const session = getSession(db, req.params.id);
    if (!session) {
      return reply
        .code(404)
        .send(apiError("not_found", `Session ${req.params.id} not found`));
    }
    const steps = listAgentSteps(db, session.id);
    const reviews = listReviews(db, session.id);
    return { session, steps, reviews };
  });

  app.post("/v1/sessions", async (req, reply) => {
    const parsed = CreateSessionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          apiError(
            "validation_error",
            "Invalid session payload",
            parsed.error.flatten(),
          ),
        );
    }

    const project = getProject(db, parsed.data.project_id);
    if (!project) {
      return reply
        .code(404)
        .send(
          apiError(
            "not_found",
            `Project ${parsed.data.project_id} not found`,
          ),
        );
    }

    let session = createSession(db, parsed.data);
    // Write markup workspace payload on submit (M3).
    try {
      const written = writeSessionMarkup(cfg, db, session);
      session = getSession(db, session.id) ?? {
        ...session,
        annotation_ref: written.annotation_ref,
      };
    } catch (err) {
      return reply
        .code(500)
        .send(
          apiError(
            "markup_write_failed",
            (err as Error).message ?? "Failed to write markup workspace",
          ),
        );
    }

    hub.broadcastStatus(session.id, session.status, session.step_count);
    return reply.code(201).send({ session });
  });

  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/start",
    async (req, reply) => {
      try {
        // Fire loop; for smoke we await completion to awaiting_review/failed.
        const session = await startSessionLoop(cfg, db, hub, req.params.id);
        return { session };
      } catch (err) {
        const code = (err as { code?: string }).code ?? "loop_error";
        const status =
          code === "not_found"
            ? 404
            : code === "invalid_status" || code === "repo_busy" || code === "loop_busy"
              ? 409
              : 500;
        return reply
          .code(status)
          .send(apiError(code, (err as Error).message));
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/review",
    async (req, reply) => {
      const parsed = ReviewInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid review payload",
              parsed.error.flatten(),
            ),
          );
      }
      try {
        const result = await reviewSession(
          cfg,
          db,
          hub,
          req.params.id,
          parsed.data.decision,
          parsed.data.note,
        );
        return result;
      } catch (err) {
        const code = (err as { code?: string }).code ?? "review_error";
        const status =
          code === "not_found"
            ? 404
            : code === "invalid_status" || code === "no_base"
              ? 409
              : 500;
        return reply
          .code(status)
          .send(apiError(code, (err as Error).message));
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/diff",
    async (req, reply) => {
      try {
        return getSessionDiff(db, req.params.id);
      } catch (err) {
        const code = (err as { code?: string }).code ?? "diff_error";
        return reply
          .code(code === "not_found" ? 404 : 500)
          .send(apiError(code, (err as Error).message));
      }
    },
  );
};
