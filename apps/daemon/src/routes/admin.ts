import { createReadStream } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import { getMetrics, listAudit, type Database } from "@sightloop/db";
import { apiError } from "@sightloop/shared";
import type { DaemonConfig } from "../config.js";
import {
  applyLlmSettingsPatch,
  getLlmSettingsPublic,
  type LlmSettingsPatch,
} from "../llm-settings.js";
import {
  buildExtension,
  createExtensionZip,
  getExtensionInstallInfo,
} from "../extension-install.js";

export type AdminRouteOpts = {
  db: Database;
  cfg: DaemonConfig;
};

export const adminRoutes: FastifyPluginAsync<AdminRouteOpts> = async (
  app,
  opts,
) => {
  const { db, cfg } = opts;

  app.get("/v1/admin/metrics", async () => {
    return { metrics: getMetrics(db) };
  });

  app.get<{
    Querystring: {
      project_id?: string;
      session_id?: string;
      limit?: string;
    };
  }>("/v1/admin/audit", async (req) => {
    const limit = req.query.limit
      ? Number.parseInt(req.query.limit, 10)
      : 100;
    const events = listAudit(db, {
      project_id: req.query.project_id,
      session_id: req.query.session_id,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return { audit: events };
  });

  // --- LLM / model settings (masked; persisted under data/llm-settings.env) ---
  app.get("/v1/admin/llm-settings", async () => {
    return {
      settings: getLlmSettingsPublic(),
      daemon_version: cfg.version,
    };
  });

  app.put<{ Body: LlmSettingsPatch }>("/v1/admin/llm-settings", async (req) => {
    const body = (req.body ?? {}) as LlmSettingsPatch;
    const settings = applyLlmSettingsPatch(body);
    return {
      settings,
      applied_live: true,
      restart_hint:
        "Settings applied to the running Daemon process and written to data/llm-settings.env. Compose `env_file` values are overridden by this file on next start.",
    };
  });

  // --- Chrome MV3 extension install helpers ---
  app.get("/v1/admin/extension", async () => {
    return { extension: getExtensionInstallInfo() };
  });

  app.post("/v1/admin/extension/build", async (_req, reply) => {
    const result = await buildExtension();
    if (!result.ok) {
      return reply.code(500).send(
        apiError("extension_build_failed", "Extension build failed", {
          log_tail: result.log_tail,
          dist: result.dist,
        }),
      );
    }
    return {
      ok: true,
      extension: getExtensionInstallInfo(),
      log_tail: result.log_tail,
    };
  });

  app.get("/v1/admin/extension/zip", async (_req, reply) => {
    try {
      const zip = createExtensionZip();
      reply.header("Content-Type", "application/zip");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${zip.filename}"`,
      );
      return reply.send(createReadStream(zip.path));
    } catch (err) {
      return reply
        .code(409)
        .send(
          apiError(
            "extension_not_built",
            (err as Error).message || "Extension zip unavailable",
          ),
        );
    }
  });
};
