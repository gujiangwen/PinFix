import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "migrations");
const dest = join(root, "dist", "migrations");

if (!existsSync(src)) {
  console.error("migrations/ missing");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("Copied migrations → dist/migrations");
