import type { FastifyPluginAsync } from "fastify";
import { listKnowledge, type Database } from "@sightloop/db";

export type KnowledgeRouteOpts = {
  db: Database;
};

export const knowledgeRoutes: FastifyPluginAsync<KnowledgeRouteOpts> = async (
  app,
  opts,
) => {
  const { db } = opts;

  app.get<{ Querystring: { project_id?: string } }>(
    "/v1/knowledge",
    async (req) => {
      const items = listKnowledge(db, req.query.project_id);
      return { knowledge: items };
    },
  );
};
