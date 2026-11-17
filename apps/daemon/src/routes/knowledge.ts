import type { FastifyPluginAsync } from "fastify";
import {
  CreateKnowledgeInputSchema,
  UpdateKnowledgeInputSchema,
  KnowledgeFilterSchema,
  SyncAgentsMdInputSchema,
  apiError,
} from "@sightloop/shared";
import {
  createKnowledgeFromInput,
  getKnowledge,
  getProject,
  queryKnowledge,
  updateKnowledge,
  deleteKnowledge,
  listKnowledgeByIds,
  insertAudit,
  type Database,
} from "@sightloop/db";
import type { DaemonConfig } from "../config.js";
import { syncKnowledgeToAgentsMd } from "../agents-md.js";

export type KnowledgeRouteOpts = {
  db: Database;
  cfg: DaemonConfig;
};

export const knowledgeRoutes: FastifyPluginAsync<KnowledgeRouteOpts> = async (
  app,
  opts,
) => {
  const { db, cfg } = opts;

  app.get("/v1/knowledge", async (req, reply) => {
    const parsed = KnowledgeFilterSchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          apiError(
            "validation_error",
            "Invalid knowledge filter",
            parsed.error.flatten(),
          ),
        );
    }
    const items = queryKnowledge(db, parsed.data);
    return { knowledge: items };
  });

  app.get<{ Params: { id: string } }>(
    "/v1/knowledge/:id",
    async (req, reply) => {
      const item = getKnowledge(db, req.params.id);
      if (!item) {
        return reply
          .code(404)
          .send(apiError("not_found", `Knowledge ${req.params.id} not found`));
      }
      return { knowledge: item };
    },
  );

  app.post("/v1/knowledge", async (req, reply) => {
    const parsed = CreateKnowledgeInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          apiError(
            "validation_error",
            "Invalid knowledge payload",
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
    const item = createKnowledgeFromInput(db, parsed.data);
    insertAudit(
      db,
      "knowledge_created",
      { knowledge_id: item.id, title: item.title },
      project.id,
      item.session_id,
    );
    return reply.code(201).send({ knowledge: item });
  });

  app.patch<{ Params: { id: string } }>(
    "/v1/knowledge/:id",
    async (req, reply) => {
      const parsed = UpdateKnowledgeInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid knowledge patch",
              parsed.error.flatten(),
            ),
          );
      }
      const updated = updateKnowledge(db, req.params.id, parsed.data);
      if (!updated) {
        return reply
          .code(404)
          .send(apiError("not_found", `Knowledge ${req.params.id} not found`));
      }
      insertAudit(
        db,
        "knowledge_updated",
        { knowledge_id: updated.id, patch: parsed.data },
        updated.project_id,
        updated.session_id,
      );
      return { knowledge: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/knowledge/:id",
    async (req, reply) => {
      const existing = getKnowledge(db, req.params.id);
      if (!existing) {
        return reply
          .code(404)
          .send(apiError("not_found", `Knowledge ${req.params.id} not found`));
      }
      deleteKnowledge(db, req.params.id);
      insertAudit(
        db,
        "knowledge_deleted",
        { knowledge_id: existing.id, title: existing.title },
        existing.project_id,
        existing.session_id,
      );
      return reply.code(204).send();
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { format?: string };
  }>("/v1/knowledge/:id/export", async (req, reply) => {
    const item = getKnowledge(db, req.params.id);
    if (!item) {
      return reply
        .code(404)
        .send(apiError("not_found", `Knowledge ${req.params.id} not found`));
    }
    const md = `# ${item.title}\n\n_kind: ${item.kind}_\n\n${item.body_md}\n`;
    if (req.query.format === "raw") {
      return reply
        .type("text/markdown; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="sightloop-${item.id}.md"`,
        )
        .send(md);
    }
    return { knowledge: item, markdown: md };
  });

  app.post<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/knowledge/sync-agents",
    async (req, reply) => {
      const parsed = SyncAgentsMdInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid sync payload",
              parsed.error.flatten(),
            ),
          );
      }
      const project = getProject(db, req.params.projectId);
      if (!project) {
        return reply
          .code(404)
          .send(
            apiError("not_found", `Project ${req.params.projectId} not found`),
          );
      }

      let cards =
        parsed.data.knowledge_ids && parsed.data.knowledge_ids.length > 0
          ? listKnowledgeByIds(db, parsed.data.knowledge_ids)
          : queryKnowledge(db, {
              project_id: project.id,
              pinned: true,
              include_archived: false,
              limit: 50,
            });

      cards = cards.filter((c) => c.project_id === project.id && !c.archived);
      if (cards.length === 0) {
        // Fall back to recent non-archived for suggestion when nothing pinned.
        cards = queryKnowledge(db, {
          project_id: project.id,
          include_archived: false,
          limit: 10,
        });
      }
      if (cards.length === 0) {
        return reply
          .code(409)
          .send(apiError("empty_knowledge", "No knowledge cards to sync"));
      }

      try {
        const result = syncKnowledgeToAgentsMd({
          project,
          cards,
          allowedRoots: cfg.allowedRoots,
          dryRun: parsed.data.dry_run,
        });
        insertAudit(
          db,
          result.wrote ? "agents_md_synced" : "agents_md_sync_preview",
          {
            path: result.path,
            knowledge_ids: result.knowledge_ids,
            bytes: result.bytes,
          },
          project.id,
          null,
        );
        return { sync: result };
      } catch (err) {
        const code = (err as { code?: string }).code ?? "sync_failed";
        const status =
          code === "path_escape_blocked" || code === "whitelist_blocked"
            ? 403
            : code.startsWith("path_")
              ? 400
              : 500;
        insertAudit(
          db,
          "agents_md_sync_blocked",
          { code, message: (err as Error).message },
          project.id,
          null,
        );
        return reply
          .code(status)
          .send(apiError(code, (err as Error).message));
      }
    },
  );
};
