import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  openDatabase,
  migrate,
  reindexAllKnowledge,
  isVecReady,
  type Database,
} from "@sightloop/db";
import type { DaemonConfig } from "./config.js";
import { createAuthPlugin } from "./auth.js";
import { projectsRoutes } from "./routes/projects.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { adminRoutes } from "./routes/admin.js";
import { dxRoutes } from "./routes/dx.js";
import { locationRoutes } from "./routes/location.js";
import { wsRoutes } from "./routes/ws.js";
import { SessionWsHub } from "./ws-hub.js";

export type BuiltApp = {
  app: ReturnType<typeof Fastify>;
  db: Database;
  hub: SessionWsHub;
};

export async function buildApp(cfg: DaemonConfig): Promise<BuiltApp> {
  const db = openDatabase(cfg.dbPath);
  migrate(db);
  if (isVecReady()) {
    const n = reindexAllKnowledge(db);
    if (n > 0) {
      console.info(`[sightloop] sqlite-vec reindexed ${n} knowledge cards`);
    }
  }
  const hub = new SessionWsHub();

  const app = Fastify({
    logger: true,
    trustProxy: false,
  });

  await app.register(cors, {
    origin: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-SightLoop-Token",
      "X-PinFix-Token",
    ],
  });

  await app.register(createAuthPlugin(cfg.token));

  app.get("/health", async () => ({
    ok: true as const,
    service: "sightloop-daemon" as const,
    version: cfg.version,
    now: Date.now(),
  }));

  await app.register(projectsRoutes, {
    db,
    allowedRoots: cfg.allowedRoots,
  });

  await app.register(sessionsRoutes, { db, hub, cfg });
  await app.register(knowledgeRoutes, { db, cfg });
  await app.register(adminRoutes, { db });
  await app.register(dxRoutes, { db, cfg });
  await app.register(locationRoutes, { db });
  await app.register(wsRoutes, { db, hub, token: cfg.token });

  return { app, db, hub };
}
