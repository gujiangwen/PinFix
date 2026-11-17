import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./client.js";
import { migrate } from "./migrate.js";
import {
  createCheckpoint,
  countCheckpointsForSession,
  gcCheckpoints,
  resumeCheckpoint,
  consumeCheckpoint,
  listCheckpoints,
} from "./checkpoints.js";

function seedProjectSession(db: ReturnType<typeof openDatabase>, repo: string) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, repo_path, origin_pattern, mode, default_branch, file_whitelist, created_at, updated_at)
     VALUES ('p1','t',?, 'http://127.0.0.1:5175/*', 'hmr', 'main', '["src/**"]', ?, ?)`,
  ).run(repo, now, now);
  db.prepare(
    `INSERT INTO sessions (id, project_id, status, page_url, max_steps, step_count, created_at, updated_at)
     VALUES ('s1','p1','awaiting_review','http://127.0.0.1:5175/', 8, 0, ?, ?)`,
  ).run(now, now);
}

describe("R4 checkpoint N-cap + GC", () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sl-cp-"));
    db = openDatabase(join(dir, "t.sqlite"));
    migrate(db);
    seedProjectSession(db, "/tmp/repo-a");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("evicts oldest when over N", () => {
    for (let i = 0; i < 5; i++) {
      createCheckpoint(db, {
        session_id: "s1",
        project_id: "p1",
        repo_path: "/tmp/repo-a",
        issue_ids: [`i${i}`],
        max_per_session: 3,
      });
    }
    expect(countCheckpointsForSession(db, "s1")).toBe(3);
  });

  it("GC removes consumed and count drops", () => {
    const a = createCheckpoint(db, {
      session_id: "s1",
      project_id: "p1",
      repo_path: "/tmp/repo-a",
      issue_ids: ["a"],
      max_per_session: 20,
    });
    createCheckpoint(db, {
      session_id: "s1",
      project_id: "p1",
      repo_path: "/tmp/repo-a",
      issue_ids: ["b"],
      max_per_session: 20,
    });
    consumeCheckpoint(db, a.id);
    const before = countCheckpointsForSession(db, "s1");
    const deleted = gcCheckpoints(db, { session_id: "s1", consumed: true });
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(countCheckpointsForSession(db, "s1")).toBe(before - deleted);
  });
});

describe("R8 resume project/repo bind", () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sl-cp2-"));
    db = openDatabase(join(dir, "t.sqlite"));
    migrate(db);
    seedProjectSession(db, "/tmp/repo-a");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects resume with wrong repo_path", () => {
    const cp = createCheckpoint(db, {
      session_id: "s1",
      project_id: "p1",
      repo_path: "/tmp/repo-a",
      issue_ids: ["x"],
    });
    const bad = resumeCheckpoint(db, cp.id, {
      project_id: "p1",
      repo_path: "/tmp/other-repo",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("bind_mismatch");
  });

  it("resume succeeds with matching bind and keeps issue_ids", () => {
    const cp = createCheckpoint(db, {
      session_id: "s1",
      project_id: "p1",
      repo_path: "/tmp/repo-a",
      issue_ids: ["issue:1", "issue:2"],
      wip_commit: "abc123",
    });
    const ok = resumeCheckpoint(db, cp.id, {
      project_id: "p1",
      repo_path: "/tmp/repo-a",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.checkpoint.status).toBe("resumed");
      expect(ok.checkpoint.issue_ids).toEqual(["issue:1", "issue:2"]);
      expect(ok.checkpoint.wip_commit).toBe("abc123");
    }
    expect(listCheckpoints(db, { session_id: "s1", limit: 10 }).length).toBe(1);
  });
});
