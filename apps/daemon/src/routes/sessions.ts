import type { FastifyPluginAsync } from "fastify";
import {
  CreateSessionInputSchema,
  PlanIRSchema,
  ReviewInputSchema,
  apiError,
} from "@sightloop/shared";
import {
  createSession,
  getProject,
  getSession,
  getSessionAgentReview,
  getSessionPlan,
  insertAudit,
  listSessions,
  setSessionPlan,
  type Database,
} from "@sightloop/db";
import { filterPlanFilesByProject } from "@sightloop/dual-loop";
import type { SessionWsHub } from "../ws-hub.js";
import type { DaemonConfig } from "../config.js";
import {
  startSessionLoop,
  reviewSession,
  getSessionDiff,
  writeSessionMarkup,
} from "../loop-service.js";
import {
  buildSessionReadModel,
  summarizePatch,
} from "../session-read-model.js";

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
    const model = buildSessionReadModel(db, req.params.id);
    if (!model) {
      return reply
        .code(404)
        .send(apiError("not_found", `Session ${req.params.id} not found`));
    }
    return {
      session: model.session,
      steps: model.steps,
      reviews: model.reviews,
      timeline: model.timeline,
      verify: model.verify,
      recall_hits: model.recall_hits,
      diff_summary: model.diff_summary,
      latest_knowledge: model.latest_knowledge,
      acceptance_gate: model.acceptance_gate,
      plan: model.plan,
      agent_review: model.agent_review,
    };
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
          parsed.data.force_accept,
          {
            remember: parsed.data.remember,
            lesson: parsed.data.lesson,
          },
        );
        return result;
      } catch (err) {
        const code = (err as { code?: string }).code ?? "review_error";
        const details = (err as { details?: unknown }).details;
        const status =
          code === "not_found"
            ? 404
            : code === "invalid_status" ||
                code === "no_base" ||
                code === "acceptance_gate_failed" ||
                code === "force_accept_denied"
              ? 409
              : 500;
        return reply
          .code(status)
          .send(apiError(code, (err as Error).message, details));
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/plan",
    async (req, reply) => {
      const session = getSession(db, req.params.id);
      if (!session) {
        return reply
          .code(404)
          .send(apiError("not_found", `Session ${req.params.id} not found`));
      }
      return { plan: getSessionPlan(db, req.params.id) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/v1/sessions/:id/plan",
    async (req, reply) => {
      const session = getSession(db, req.params.id);
      if (!session) {
        return reply
          .code(404)
          .send(apiError("not_found", `Session ${req.params.id} not found`));
      }
      if (
        session.status !== "awaiting_review" &&
        session.status !== "idle" &&
        session.status !== "failed"
      ) {
        return reply
          .code(409)
          .send(
            apiError(
              "invalid_status",
              `Plan edit requires awaiting_review (have ${session.status})`,
            ),
          );
      }
      const project = getProject(db, session.project_id);
      if (!project) {
        return reply
          .code(404)
          .send(apiError("not_found", "Project not found"));
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const existing = getSessionPlan(db, session.id);
      const allowedRaw = Array.isArray(body.allowed_files)
        ? body.allowed_files.map(String)
        : typeof body.allowed_files === "string"
          ? String(body.allowed_files)
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : existing?.allowed_files ?? [];
      const allowed = filterPlanFilesByProject(
        allowedRaw
          .map((f) => f.replace(/\\/g, "/").replace(/^\.\//, "").trim())
          .filter((f) => f && !f.startsWith("/") && !f.includes("..")),
        project.file_whitelist,
      );
      if (!allowed.length) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "allowed_files empty after project whitelist filter",
            ),
          );
      }

      const parsed = PlanIRSchema.safeParse({
        version: 1,
        session_id: session.id,
        root_cause: String(
          body.root_cause ?? existing?.root_cause ?? "Human-edited plan",
        ),
        hypothesis:
          body.hypothesis != null
            ? String(body.hypothesis)
            : existing?.hypothesis,
        allowed_files: allowed,
        forbidden_files: existing?.forbidden_files,
        risks: existing?.risks ?? [],
        steps_hint: existing?.steps_hint ?? [],
        confidence: existing?.confidence,
        planner_model: existing?.planner_model ?? "human-edit",
        created_at: Date.now(),
      });
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid PlanIR",
              parsed.error.flatten(),
            ),
          );
      }

      setSessionPlan(db, session.id, parsed.data);
      insertAudit(
        db,
        "plan_human_edited",
        {
          allowed_files: parsed.data.allowed_files,
          root_cause: parsed.data.root_cause.slice(0, 200),
        },
        project.id,
        session.id,
      );
      hub.broadcastPlan(
        session.id,
        parsed.data as unknown as Record<string, unknown>,
      );
      return { plan: parsed.data };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/agent-review",
    async (req, reply) => {
      const session = getSession(db, req.params.id);
      if (!session) {
        return reply
          .code(404)
          .send(apiError("not_found", `Session ${req.params.id} not found`));
      }
      return { review: getSessionAgentReview(db, req.params.id) };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/diff",
    async (req, reply) => {
      try {
        const diff = getSessionDiff(db, req.params.id);
        return {
          ...diff,
          summary: summarizePatch(diff.patch),
        };
      } catch (err) {
        const code = (err as { code?: string }).code ?? "diff_error";
        return reply
          .code(code === "not_found" ? 404 : 500)
          .send(apiError(code, (err as Error).message));
      }
    },
  );
};
