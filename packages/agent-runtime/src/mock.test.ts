import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockRunner } from "./runners/mock.js";
import { distillOnAccept } from "./distill.js";
import { ensureGitRepo, createTempCommit, diffPatch, getHeadSha } from "./git.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("mock runner + git", () => {
  it("edits whitelist file and creates temp commit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-agent-"));
    dirs.push(dir);
    ensureGitRepo(dir);
    const base = getHeadSha(dir);

    const runner = createMockRunner();
    const act = await runner.act({
      sessionId: "01TESTSESSION000000000000",
      repoPath: dir,
      pageUrl: "http://localhost:5175/",
      annotation: {
        id: "2026-11-17_demo",
        slug: "demo",
        created_at: new Date().toISOString(),
        md_path: "",
        png_path: null,
        markdown: "# demo",
        note: "fix button",
        selector: "[data-testid=buy]",
      },
      sniff: { framework: "react" },
      knowledgeStub: [],
      fileWhitelist: ["src/**"],
      maxSteps: 5,
      stepBudget: 3,
    });

    expect(act.dryRun).toBe(true);
    expect(act.filesTouched[0]).toMatch(/^src\//);
    expect(existsSync(join(dir, act.filesTouched[0]!))).toBe(true);

    const sha = createTempCommit(dir, "sightloop: wip test");
    expect(sha).toBeTruthy();
    const patch = diffPatch(dir, base, sha);
    expect(patch.length).toBeGreaterThan(0);
    expect(readFileSync(join(dir, act.filesTouched[0]!), "utf8")).toContain(
      "SightLoop mock",
    );
  });
});

describe("distill", () => {
  it("builds markdown knowledge", () => {
    const d = distillOnAccept({
      sessionId: "s1",
      pageUrl: "http://x/",
      annotationNote: "teal CTA",
      selector: ".buy",
      patch: "+hello",
      actSummary: "mock edit",
    });
    expect(d.kind).toBe("pattern");
    expect(d.body_md).toContain("teal CTA");
  });
});
