import { realpathSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

export type PathCheckResult =
  | { ok: true; realPath: string }
  | { ok: false; code: string; message: string };

function normalizeRoot(root: string): string {
  const abs = resolve(root);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

function isUnderRoot(realPath: string, root: string): boolean {
  const rel = relative(root, realPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Validate that repo_path exists (or can be created as a directory when
 * `createIfMissing`), resolves via realpath, and falls under one of the
 * allowed roots (SIGHTLOOP_ALLOWED_ROOTS / PINFIX_ALLOWED_ROOTS).
 */
export function assertAllowedRepoPath(
  repoPath: string,
  allowedRoots: string[],
  opts: { createIfMissing?: boolean } = {},
): PathCheckResult {
  if (!repoPath || !isAbsolute(repoPath)) {
    return {
      ok: false,
      code: "path_not_absolute",
      message: "repo_path must be an absolute path",
    };
  }

  const resolved = resolve(repoPath);

  if (!existsSync(resolved)) {
    if (opts.createIfMissing) {
      try {
        mkdirSync(resolved, { recursive: true });
      } catch (err) {
        return {
          ok: false,
          code: "path_create_failed",
          message: `Could not create repo_path: ${(err as Error).message}`,
        };
      }
    } else {
      return {
        ok: false,
        code: "path_missing",
        message: `repo_path does not exist: ${resolved}`,
      };
    }
  }

  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch (err) {
    return {
      ok: false,
      code: "path_unresolvable",
      message: `Could not realpath repo_path: ${(err as Error).message}`,
    };
  }

  try {
    if (!statSync(realPath).isDirectory()) {
      return {
        ok: false,
        code: "path_not_directory",
        message: "repo_path must be a directory",
      };
    }
  } catch (err) {
    return {
      ok: false,
      code: "path_stat_failed",
      message: (err as Error).message,
    };
  }

  const roots = allowedRoots.map(normalizeRoot);
  const allowed = roots.some((root) => isUnderRoot(realPath, root));
  if (!allowed) {
    return {
      ok: false,
      code: "path_escape_blocked",
      message: `repo_path is outside SIGHTLOOP_ALLOWED_ROOTS: ${realPath}`,
    };
  }

  return { ok: true, realPath };
}
