import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentActContext, AgentActResult, AgentRunner } from "./types.js";
import { createMockRunner } from "./mock.js";

export type PiRunnerOptions = {
  /** Max tool/steps hard cap (default 5). */
  maxSteps?: number;
  /** Working prompt file directory under repo. */
  promptDir?: string;
  timeoutMs?: number;
};

function buildPrompt(ctx: AgentActContext): string {
  const ann = ctx.annotation;
  return [
    "You are SightLoop's coding agent. Apply a minimal fix for the annotation.",
    `Session: ${ctx.sessionId}`,
    `Page: ${ctx.pageUrl}`,
    `Max steps: ${ctx.stepBudget}`,
    "",
    "## Annotation",
    ann?.markdown?.slice(0, 6000) ?? "(none)",
    "",
    "## Sniff (JSON)",
    JSON.stringify(ctx.sniff, null, 2).slice(0, 4000),
    "",
    "## Knowledge (stub)",
    ctx.knowledgeStub.length === 0
      ? "(empty)"
      : ctx.knowledgeStub
          .map((k) => `### ${k.title}\n${k.body_md}`)
          .join("\n\n")
          .slice(0, 4000),
    "",
    ctx.refineNote ? `## Refine note\n${ctx.refineNote}\n` : "",
    "## Constraints",
    `- Stay inside repo cwd`,
    `- Prefer files matching whitelist: ${ctx.fileWhitelist.join(", ") || "(any under repo)"}`,
    `- Do not push or force-reset`,
    "",
  ].join("\n");
}

/**
 * Pi coding-agent runner via `@mariozechner/pi-coding-agent` CLI (`pi`).
 * Falls back to mock edit if the CLI is unavailable so demos still work.
 */
export function createPiRunner(opts: PiRunnerOptions = {}): AgentRunner {
  const maxSteps = Math.min(opts.maxSteps ?? 5, 5);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const mock = createMockRunner();

  return {
    name: "pi",
    async act(ctx: AgentActContext): Promise<AgentActResult> {
      const budget = Math.min(ctx.stepBudget, maxSteps);
      const promptDir = resolve(
        ctx.repoPath,
        opts.promptDir ?? ".sightloop",
      );
      mkdirSync(promptDir, { recursive: true });
      const promptPath = join(promptDir, `prompt-${ctx.sessionId}.md`);
      writeFileSync(promptPath, buildPrompt({ ...ctx, stepBudget: budget }), "utf8");

      const result = await runPiOnce({
        cwd: ctx.repoPath,
        promptPath,
        timeoutMs,
      });

      if (!result.ok) {
        const fallback = await mock.act(ctx);
        return {
          ...fallback,
          runner: "pi",
          dryRun: true,
          summary: `pi unavailable (${result.error}); applied mock fallback: ${fallback.summary}`,
          detail: { pi: result, fallback: fallback.detail },
          stepsUsed: Math.min(budget, fallback.stepsUsed || 1),
        };
      }

      return {
        summary: result.summary || "pi completed",
        stepsUsed: Math.min(budget, result.stepsUsed || 1),
        filesTouched: result.filesTouched,
        dryRun: false,
        runner: "pi",
        detail: { stdout: result.stdout.slice(0, 4000) },
      };
    },
  };
}

function runPiOnce(input: {
  cwd: string;
  promptPath: string;
  timeoutMs: number;
}): Promise<{
  ok: boolean;
  error?: string;
  summary?: string;
  stepsUsed?: number;
  filesTouched: string[];
  stdout: string;
}> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "npx",
      ["-y", "@mariozechner/pi-coding-agent", "--print"],
      {
        cwd: resolve(input.cwd),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += String(d);
    });

    try {
      const prompt = readFileSync(input.promptPath, "utf8");
      child.stdin?.write(prompt);
      child.stdin?.end();
    } catch (err) {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        error: (err as Error).message,
        filesTouched: [],
        stdout: "",
      });
      return;
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        error: err.message,
        filesTouched: [],
        stdout,
      });
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolvePromise({
          ok: false,
          error: stderr.slice(0, 500) || `exit ${code}`,
          filesTouched: [],
          stdout,
        });
        return;
      }
      resolvePromise({
        ok: true,
        summary: "pi exited 0",
        stepsUsed: 1,
        filesTouched: [],
        stdout,
      });
    });
  });
}
