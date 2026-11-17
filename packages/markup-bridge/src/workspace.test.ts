import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  writeAnnotationWorkspace,
  listWorkspaceSessions,
  readLatestWorkspaceSession,
} from "./workspace.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("markup workspace", () => {
  it("writes and reads annotation sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-markup-"));
    dirs.push(dir);

    const meta = writeAnnotationWorkspace({
      workspaceDir: dir,
      slug: "Button Color!",
      pageUrl: "http://localhost:5175/",
      note: "make CTA teal",
      selector: "[data-testid=buy]",
      sniff: { framework: "react" },
      date: "2026-11-17",
    });

    expect(meta.id).toBe("2026-11-17_button-color");
    expect(listWorkspaceSessions(dir)).toHaveLength(1);
    const latest = readLatestWorkspaceSession(dir);
    expect(latest?.markdown).toContain("make CTA teal");
    expect(latest?.selector).toBe("[data-testid=buy]");
  });
});
