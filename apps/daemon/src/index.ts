import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

async function main() {
  const cfg = loadConfig();
  const { app, db } = await buildApp(cfg);

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      db.close();
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ host: cfg.host, port: cfg.port });
  app.log.info(
    {
      host: cfg.host,
      port: cfg.port,
      dbPath: cfg.dbPath,
      allowedRoots: cfg.allowedRoots,
    },
    "SightLoop daemon listening",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
