import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function migrationsDir(): string {
  // Prefer dist/migrations next to compiled code; fall back to package root for tsx.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "migrations"),
    join(here, "..", "migrations"),
  ];
  for (const c of candidates) {
    try {
      readdirSync(c);
      return c;
    } catch {
      // try next
    }
  }
  throw new Error("Could not locate packages/db/migrations");
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const current =
    (
      db
        .prepare("SELECT MAX(version) AS v FROM schema_version")
        .get() as { v: number | null }
    ).v ?? 0;

  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file.split("_")[0]!, 10);
    if (version <= current) continue;

    const sql = readFileSync(join(dir, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(version, Date.now());
    });
    apply();
  }
}
