import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this file until pnpm-workspace.yaml is found. */
export function findMonorepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function resolveFromRoot(pathLike: string): string {
  if (pathLike.startsWith("/")) return pathLike;
  return resolve(findMonorepoRoot(), pathLike);
}
