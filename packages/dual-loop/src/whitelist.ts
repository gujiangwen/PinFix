import { resolve, relative, isAbsolute, sep } from "node:path";

/** Exact relative file path match (M9a default — no directory prefix). */
export function isExactAllowed(
  relPath: string,
  allowedFiles: string[],
): boolean {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return allowedFiles.some((a) => a.replace(/\\/g, "/").replace(/^\.\//, "") === norm);
}

export function assertWriteAllowed(
  repoPath: string,
  absOrRel: string,
  allowedFiles: string[],
  projectWhitelist: string[],
): { ok: true; rel: string } | { ok: false; code: string; message: string } {
  const repo = resolve(repoPath);
  const abs = isAbsolute(absOrRel) ? resolve(absOrRel) : resolve(repo, absOrRel);
  if (abs !== repo && !abs.startsWith(repo + sep)) {
    return { ok: false, code: "path_escape", message: "Path escapes repo_path" };
  }
  const rel = relative(repo, abs).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) {
    return { ok: false, code: "path_escape", message: "Invalid relative path" };
  }
  if (projectWhitelist.length > 0) {
    const inProject = projectWhitelist.some((pat) => {
      const p = pat.replace(/\\/g, "/");
      if (p.endsWith("/**")) {
        const prefix = p.slice(0, -3);
        return rel === prefix || rel.startsWith(prefix + "/");
      }
      return rel === p || rel.startsWith(p.replace(/\*$/, ""));
    });
    if (!inProject) {
      return {
        ok: false,
        code: "project_whitelist_blocked",
        message: `${rel} outside project file_whitelist`,
      };
    }
  }
  if (!isExactAllowed(rel, allowedFiles)) {
    return {
      ok: false,
      code: "plan_whitelist_blocked",
      message: `${rel} not in PlanIR.allowed_files`,
    };
  }
  return { ok: true, rel };
}

/** Intersect plan files with project whitelist (exact files that match patterns). */
export function filterPlanFilesByProject(
  allowedFiles: string[],
  projectWhitelist: string[],
): string[] {
  if (!projectWhitelist.length) return allowedFiles;
  return allowedFiles.filter((f) => {
    const norm = f.replace(/\\/g, "/");
    return projectWhitelist.some((pat) => {
      const p = pat.replace(/\\/g, "/");
      if (p.endsWith("/**")) {
        const prefix = p.slice(0, -3);
        return norm === prefix || norm.startsWith(prefix + "/");
      }
      if (p.endsWith("/*")) {
        const prefix = p.slice(0, -2);
        const rest = norm.startsWith(prefix + "/")
          ? norm.slice(prefix.length + 1)
          : "";
        return rest.length > 0 && !rest.includes("/");
      }
      return norm === p;
    });
  });
}
