import Fastify from "fastify";
import cors from "@fastify/cors";
import { openDatabase, migrate, type Database } from "@sightloop/db";
import type { DaemonConfig } from "./config.js";
import { createAuthPlugin } from "./auth.js";
import { projectsRoutes } from "./routes/projects.js";

export type BuiltApp = {
  app: ReturnType<typeof Fastify>;
  db: Database;
};

export async function buildApp(cfg: DaemonConfig): Promise<BuiltApp> {
  const db = openDatabase(cfg.dbPath);
  migrate(db);

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

  return { app, db };
}
