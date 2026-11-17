import type { FastifyPluginAsync } from "fastify";
import {
  CreateSessionInputSchema,
  apiError,
} from "@sightloop/shared";
import {
  createSession,
  getProject,
  getSession,
  listSessions,
  type Database,
} from "@sightloop/db";
import type { SessionWsHub } from "../ws-hub.js";

export type SessionsRouteOpts = {
  db: Database;
  hub: SessionWsHub;
};

export const sessionsRoutes: FastifyPluginAsync<SessionsRouteOpts> = async (
  app,
  opts,
) => {
  const { db, hub } = opts;

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
    return { session };
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

    const session = createSession(db, parsed.data);
    hub.broadcastStatus(session.id, session.status, session.step_count);
    return reply.code(201).send({ session });
  });
};
