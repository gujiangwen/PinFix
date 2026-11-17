import type Database from "better-sqlite3";
import {
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from "@sightloop/shared";
import { ulid } from "ulid";

type ProjectRow = {
  id: string;
  name: string;
  repo_path: string;
  origin_pattern: string;
  verify_cmd: string | null;
  file_whitelist: string;
  mode: "hmr" | "pr";
  default_branch: string;
  markup_workspace: string | null;
  created_at: number;
  updated_at: number;
};

function rowToProject(row: ProjectRow): Project {
  let file_whitelist: string[] = [];
  try {
    const parsed = JSON.parse(row.file_whitelist) as unknown;
    if (Array.isArray(parsed)) {
      file_whitelist = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    file_whitelist = [];
  }

  return {
    id: row.id,
    name: row.name,
    repo_path: row.repo_path,
    origin_pattern: row.origin_pattern,
    verify_cmd: row.verify_cmd,
    file_whitelist,
    mode: row.mode,
    default_branch: row.default_branch,
    markup_workspace: row.markup_workspace,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listProjects(db: Database.Database): Project[] {
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(
  db: Database.Database,
  id: string,
): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function createProject(
  db: Database.Database,
  input: CreateProjectInput & { repo_path: string },
): Project {
  const now = Date.now();
  const project: Project = {
    id: ulid(),
    name: input.name,
    repo_path: input.repo_path,
    origin_pattern: input.origin_pattern,
    verify_cmd: input.verify_cmd ?? null,
    file_whitelist: input.file_whitelist ?? [],
    mode: input.mode ?? "hmr",
    default_branch: input.default_branch ?? "main",
    markup_workspace: input.markup_workspace ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO projects (
      id, name, repo_path, origin_pattern, verify_cmd, file_whitelist,
      mode, default_branch, markup_workspace, created_at, updated_at
    ) VALUES (
      @id, @name, @repo_path, @origin_pattern, @verify_cmd, @file_whitelist,
      @mode, @default_branch, @markup_workspace, @created_at, @updated_at
    )`,
  ).run({
    ...project,
    file_whitelist: JSON.stringify(project.file_whitelist),
  });

  return project;
}

export function updateProject(
  db: Database.Database,
  id: string,
  patch: UpdateProjectInput & { repo_path?: string },
): Project | undefined {
  const existing = getProject(db, id);
  if (!existing) return undefined;

  const next: Project = {
    ...existing,
    name: patch.name ?? existing.name,
    origin_pattern: patch.origin_pattern ?? existing.origin_pattern,
    verify_cmd:
      patch.verify_cmd !== undefined ? patch.verify_cmd : existing.verify_cmd,
    file_whitelist: patch.file_whitelist ?? existing.file_whitelist,
    mode: patch.mode ?? existing.mode,
    default_branch: patch.default_branch ?? existing.default_branch,
    markup_workspace:
      patch.markup_workspace !== undefined
        ? patch.markup_workspace
        : existing.markup_workspace,
    repo_path: patch.repo_path ?? existing.repo_path,
    updated_at: Date.now(),
  };

  db.prepare(
    `UPDATE projects SET
      name = @name,
      repo_path = @repo_path,
      origin_pattern = @origin_pattern,
      verify_cmd = @verify_cmd,
      file_whitelist = @file_whitelist,
      mode = @mode,
      default_branch = @default_branch,
      markup_workspace = @markup_workspace,
      updated_at = @updated_at
    WHERE id = @id`,
  ).run({
    ...next,
    file_whitelist: JSON.stringify(next.file_whitelist),
  });

  return next;
}

export function deleteProject(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

export function insertAudit(
  db: Database.Database,
  event: string,
  detail: unknown,
  projectId?: string | null,
  sessionId?: string | null,
): void {
  db.prepare(
    `INSERT INTO audit_log (id, project_id, session_id, event, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    ulid(),
    projectId ?? null,
    sessionId ?? null,
    event,
    JSON.stringify(detail),
    Date.now(),
  );
}
