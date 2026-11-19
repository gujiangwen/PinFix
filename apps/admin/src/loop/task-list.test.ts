import { describe, expect, it } from "vitest";
import type { Session } from "@sightloop/shared";
import { placeSession, type TaskPlacement } from "./queues";
import {
  matchesKeyword,
  runningInRole,
  sessionMatchesFilter,
  taskHaystack,
} from "./task-list";

function session(partial: Partial<Session> & Pick<Session, "id" | "status" | "created_at">): Session {
  return {
    project_id: "p",
    page_url: "http://127.0.0.1/login",
    sniff: null,
    annotation_ref: null,
    annotation: { note: "Fix the button" },
    max_steps: 3,
    step_count: 0,
    git_base_sha: null,
    temp_commit_sha: null,
    updated_at: partial.created_at,
    ...partial,
  };
}

function placed(partial: Partial<Session> & Pick<Session, "id" | "status" | "created_at">, role: TaskPlacement["role"] | null): TaskPlacement | null {
  return placeSession(session(partial), role);
}

describe("sessionMatchesFilter", () => {
  it("maps each chip onto daemon statuses", () => {
    expect(sessionMatchesFilter("idle", "open")).toBe(true);
    expect(sessionMatchesFilter("refined", "queued")).toBe(true);
    expect(sessionMatchesFilter("acting", "running")).toBe(true);
    expect(sessionMatchesFilter("awaiting_review", "review")).toBe(true);
    expect(sessionMatchesFilter("awaiting_review", "running")).toBe(false);
    expect(sessionMatchesFilter("distilling", "done")).toBe(true);
    expect(sessionMatchesFilter("accepted", "open")).toBe(false);
  });
});

describe("matchesKeyword", () => {
  const hay = taskHaystack(session({ id: "sess-9", status: "idle", created_at: 1 }), "Admin UI");

  it("matches the note, page, project name, or id", () => {
    expect(matchesKeyword(hay, "button")).toBe(true);
    expect(matchesKeyword(hay, "LOGIN")).toBe(true);
    expect(matchesKeyword(hay, "admin ui")).toBe(true);
    expect(matchesKeyword(hay, "sess-9")).toBe(true);
  });

  it("lets an empty query through and rejects a miss", () => {
    expect(matchesKeyword(hay, "   ")).toBe(true);
    expect(matchesKeyword(hay, "missing")).toBe(false);
  });
});

describe("runningInRole", () => {
  it("does not treat the oldest waiting task as running", () => {
    const waiting = placed({ id: "old", status: "idle", created_at: 1 }, null)!;
    const executing = placed({ id: "new", status: "retrieving", created_at: 2 }, null)!;
    const running = runningInRole([waiting, executing], "planner");
    expect(running.map((task) => task.session.id)).toEqual(["new"]);
  });

  it("keeps every task a role is actually executing", () => {
    const first = placed({ id: "a", status: "acting", created_at: 2 }, "implementer")!;
    const second = placed({ id: "b", status: "acting", created_at: 1 }, "implementer")!;
    const waiting = placed({ id: "c", status: "awaiting_review", created_at: 3 }, null)!;
    expect(runningInRole([first, second, waiting], "implementer").map((task) => task.session.id)).toEqual([
      "b",
      "a",
    ]);
    expect(runningInRole([waiting], "reviewer")).toEqual([]);
  });
});
