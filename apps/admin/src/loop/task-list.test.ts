import { describe, expect, it } from "vitest";
import type { Session } from "@sightloop/shared";
import { placeSession, type TaskPlacement } from "./queues";
import { defaultRunningId, matchesKeyword, queueOf, taskHaystack } from "./task-list";

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

function placed(
  partial: Partial<Session> & Pick<Session, "id" | "status" | "created_at">,
  role: TaskPlacement["role"] | null,
): TaskPlacement | null {
  return placeSession(session(partial), role);
}

describe("queueOf", () => {
  it("keeps finished sessions off every switch", () => {
    expect(queueOf(session({ id: "a", status: "accepted", created_at: 1 }), null)).toBeNull();
    expect(queueOf(session({ id: "b", status: "failed", created_at: 1 }), null)).toBeNull();
    expect(queueOf(session({ id: "c", status: "distilling", created_at: 1 }), null)).toBeNull();
  });

  it("sends awaiting_review to human review", () => {
    const task = placed({ id: "rev", status: "awaiting_review", created_at: 3 }, null);
    expect(task).toMatchObject({ role: "reviewer", executing: false });
    expect(queueOf(task!.session, task)).toBe("human");
  });

  it("follows the role the loop is actually in", () => {
    const planner = placed({ id: "p", status: "retrieving", created_at: 1 }, null)!;
    const waiting = placed({ id: "w", status: "idle", created_at: 2 }, null)!;
    const implementer = placed({ id: "i", status: "acting", created_at: 3 }, "implementer")!;
    const reviewer = placed({ id: "r", status: "acting", created_at: 4 }, "reviewer")!;
    expect(queueOf(planner.session, planner)).toBe("planner");
    expect(queueOf(waiting.session, waiting)).toBe("planner");
    expect(queueOf(implementer.session, implementer)).toBe("implementer");
    expect(queueOf(reviewer.session, reviewer)).toBe("reviewer");
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

describe("defaultRunningId", () => {
  function row(task: TaskPlacement) {
    return { session: task.session, executing: task.executing };
  }

  it("does not treat the oldest waiting task as the one to show", () => {
    const waiting = placed({ id: "old", status: "idle", created_at: 1 }, null)!;
    const executing = placed({ id: "new", status: "retrieving", created_at: 2 }, null)!;
    expect(defaultRunningId([row(waiting), row(executing)])).toBe("new");
  });

  it("shows the oldest executing task when several are running", () => {
    const first = placed({ id: "a", status: "acting", created_at: 2 }, "implementer")!;
    const second = placed({ id: "b", status: "acting", created_at: 1 }, "implementer")!;
    expect(defaultRunningId([row(first), row(second)])).toBe("b");
  });

  it("shows nothing when the switch has no executing task", () => {
    const waiting = placed({ id: "c", status: "awaiting_review", created_at: 3 }, null)!;
    expect(defaultRunningId([row(waiting)])).toBeNull();
  });
});
