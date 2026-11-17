import type { FastifyPluginAsync } from "fastify";
import { getMetrics, listAudit, type Database } from "@sightloop/db";

export type AdminRouteOpts = {
  db: Database;
};

export const adminRoutes: FastifyPluginAsync<AdminRouteOpts> = async (
  app,
  opts,
) => {
  const { db } = opts;

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
};
