import { createReadStream, statSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import {
  AcceptanceGateRunInputSchema,
  apiError,
} from "@sightloop/shared";
import {
  getAcceptanceRun,
  getLatestAcceptanceRun,
  getSession,
  listAcceptanceRuns,
  type Database,
} from "@sightloop/db";
import type { DaemonConfig } from "../config.js";
import type { SessionWsHub } from "../ws-hub.js";
import {
  getGateArtifact,
  runSessionAcceptanceGate,
} from "../acceptance-gate-service.js";

export type AcceptanceGateRouteOpts = {
  db: Database;
  hub: SessionWsHub;
  cfg: DaemonConfig;
};

export const acceptanceGateRoutes: FastifyPluginAsync<
  AcceptanceGateRouteOpts
> = async (app, opts) => {
  const { db, hub, cfg } = opts;

  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/acceptance-gate/run",
    async (req, reply) => {
      const parsed = AcceptanceGateRunInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid acceptance-gate run payload",
              parsed.error.flatten(),
            ),
          );
      }
      try {
        const run = await runSessionAcceptanceGate(
          cfg,
          db,
          hub,
          req.params.id,
          parsed.data.reason,
        );
        return { run };
      } catch (err) {
        const code = (err as { code?: string }).code ?? "gate_error";
        const status =
          code === "not_found"
            ? 404
            : code === "gate_busy" || code === "compile_error" || code === "url_rejected"
              ? 409
              : 500;
        return reply
          .code(status)
          .send(apiError(code, (err as Error).message));
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/acceptance-gate",
    async (req, reply) => {
      const session = getSession(db, req.params.id);
      if (!session) {
        return reply
          .code(404)
          .send(apiError("not_found", `Session ${req.params.id} not found`));
      }
      const run = getLatestAcceptanceRun(db, req.params.id) ?? null;
      return { run };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/acceptance-gate/runs",
    async (req, reply) => {
      const session = getSession(db, req.params.id);
      if (!session) {
        return reply
          .code(404)
          .send(apiError("not_found", `Session ${req.params.id} not found`));
      }
      return { runs: listAcceptanceRuns(db, req.params.id, 20) };
    },
  );

  app.get<{ Params: { id: string; runId: string } }>(
    "/v1/sessions/:id/acceptance-gate/runs/:runId",
    async (req, reply) => {
      const run = getAcceptanceRun(db, req.params.runId);
      if (!run || run.session_id !== req.params.id) {
        return reply
          .code(404)
          .send(apiError("not_found", `Run ${req.params.runId} not found`));
      }
      return { run };
    },
  );

  app.get<{ Params: { id: string; runId: string; name: string } }>(
    "/v1/sessions/:id/acceptance-gate/runs/:runId/artifacts/:name",
    async (req, reply) => {
      const run = getAcceptanceRun(db, req.params.runId);
      if (!run || run.session_id !== req.params.id) {
        return reply
          .code(404)
          .send(apiError("not_found", `Run ${req.params.runId} not found`));
      }
      const path = getGateArtifact(
        cfg,
        req.params.id,
        req.params.runId,
        req.params.name,
      );
      if (!path) {
        return reply
          .code(404)
          .send(apiError("not_found", `Artifact ${req.params.name} not found`));
      }
      const st = statSync(path);
      const type = path.endsWith(".png")
        ? "image/png"
        : path.endsWith(".json")
          ? "application/json"
          : "application/octet-stream";
      reply.header("Content-Type", type);
      reply.header("Content-Length", st.size);
      return reply.send(createReadStream(path));
    },
  );
};
