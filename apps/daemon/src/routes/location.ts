import type { FastifyPluginAsync } from "fastify";
import {
  LocateInputSchema,
  SourceCorrectInputSchema,
  apiError,
} from "@sightloop/shared";
import {
  getProject,
  getSession,
  updateSession,
  upsertLocationHint,
  listLocationHints,
  insertKnowledge,
  insertAudit,
  type Database,
} from "@sightloop/db";
import {
  assertFileInProject,
  locateSource,
  searchProjectFiles,
} from "../source-location.js";

export type LocationRouteOpts = {
  db: Database;
};

export const locationRoutes: FastifyPluginAsync<LocationRouteOpts> = async (
  app,
  opts,
) => {
  const { db } = opts;

  app.get<{
    Params: { id: string };
    Querystring: { q?: string; limit?: string };
  }>("/v1/projects/:id/files", async (req, reply) => {
    const project = getProject(db, req.params.id);
    if (!project) {
      return reply
        .code(404)
        .send(apiError("not_found", `Project ${req.params.id} not found`));
    }
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit ?? "30", 10) || 30),
    );
    const files = searchProjectFiles(project, req.query.q ?? "", limit);
    return { files, query: req.query.q ?? "", limit };
  });

  app.get<{ Params: { id: string } }>(
    "/v1/projects/:id/source-maps",
    async (req, reply) => {
      const project = getProject(db, req.params.id);
      if (!project) {
        return reply
          .code(404)
          .send(apiError("not_found", `Project ${req.params.id} not found`));
      }
      return { hints: listLocationHints(db, project.id) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/projects/:id/locate",
    async (req, reply) => {
      const project = getProject(db, req.params.id);
      if (!project) {
        return reply
          .code(404)
          .send(apiError("not_found", `Project ${req.params.id} not found`));
      }
      const parsed = LocateInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid locate payload",
              parsed.error.flatten(),
            ),
          );
      }
      const result = await locateSource(db, project, parsed.data);
      return {
        location: result.location,
        hint_id: result.hint_id ?? null,
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/source-correct",
    async (req, reply) => {
      const session = getSession(db, req.params.id);
      if (!session) {
        return reply
          .code(404)
          .send(apiError("not_found", `Session ${req.params.id} not found`));
      }
      const project = getProject(db, session.project_id);
      if (!project) {
        return reply
          .code(404)
          .send(apiError("not_found", `Project ${session.project_id} not found`));
      }

      const parsed = SourceCorrectInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "validation_error",
              "Invalid source-correct payload",
              parsed.error.flatten(),
            ),
          );
      }

      const check = assertFileInProject(project, parsed.data.file);
      if (!check.ok) {
        insertAudit(
          db,
          "source_correct_rejected",
          { file: parsed.data.file, message: check.message },
          project.id,
          session.id,
        );
        return reply.code(400).send(apiError("path_rejected", check.message));
      }

      const sniffRaw = session.sniff;
      let sniffObj: Record<string, unknown> = {};
      if (sniffRaw && typeof sniffRaw === "object" && !Array.isArray(sniffRaw)) {
        // Envelope may be { sniff, annotation } or bare sniff.
        const asRec = sniffRaw as Record<string, unknown>;
        if (asRec.sniff && typeof asRec.sniff === "object") {
          sniffObj = { ...(asRec.sniff as Record<string, unknown>) };
        } else {
          sniffObj = { ...asRec };
        }
      }

      const selector =
        parsed.data.selector ??
        (typeof sniffObj.selector === "string" ? sniffObj.selector : null);
      const fingerprint =
        parsed.data.fingerprint ??
        (typeof sniffObj.fingerprint === "string"
          ? sniffObj.fingerprint
          : null);

      const location = {
        file: check.rel,
        line: parsed.data.line ?? null,
        column: null,
        confidence: 1,
        confidence_level: "high" as const,
        method: "human" as const,
      };

      const nextSniff = {
        ...sniffObj,
        location,
        ...(selector ? { selector } : {}),
        ...(fingerprint ? { fingerprint } : {}),
      };

      const updated = updateSession(db, session.id, { sniff: nextSniff });

      const hint = upsertLocationHint(db, {
        project_id: project.id,
        selector,
        fingerprint,
        file_path: check.rel,
        line: parsed.data.line ?? null,
        confidence: 1,
        source: "human",
      });

      const knowledge = insertKnowledge(db, {
        project_id: project.id,
        session_id: session.id,
        kind: "selector_map",
        title: `Selector → ${check.rel}`,
        body_md: [
          `# Source location correction`,
          ``,
          `- **file:** \`${check.rel}\``,
          parsed.data.line != null ? `- **line:** ${parsed.data.line}` : null,
          selector ? `- **selector:** \`${selector}\`` : null,
          fingerprint ? `- **fingerprint:** \`${fingerprint}\`` : null,
          parsed.data.note ? `- **note:** ${parsed.data.note}` : null,
          ``,
          `Corrected by human (M7).`,
        ]
          .filter(Boolean)
          .join("\n"),
        tags: ["source-location", "human-correct", ...(selector ? [selector] : [])],
        stack: typeof sniffObj.framework === "string" ? sniffObj.framework : null,
        pinned: false,
      });

      insertAudit(
        db,
        "source_correct",
        {
          file: check.rel,
          line: parsed.data.line ?? null,
          selector,
          fingerprint,
          hint_id: hint.id,
          knowledge_id: knowledge.id,
        },
        project.id,
        session.id,
      );

      return {
        session: updated,
        location,
        hint,
        knowledge: {
          id: knowledge.id,
          kind: knowledge.kind,
          title: knowledge.title,
        },
      };
    },
  );
};
