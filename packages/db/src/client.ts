import BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadSqliteVec, ensureVectorSchema } from "./vectors.js";

export type Database = BetterSqlite3.Database;

export function openDatabase(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  loadSqliteVec(db);
  ensureVectorSchema(db);
  return db;
}
