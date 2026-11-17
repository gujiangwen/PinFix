import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import type { AgentActContext, AgentActResult, AgentRunner } from "./types.js";

function matchesWhitelist(relPath: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return true;
  const norm = relPath.replace(/\\/g, "/");
  return whitelist.some((pat) => {
    const p = pat.replace(/\\/g, "/");
    if (p.endsWith("/**")) {
      const prefix = p.slice(0, -3);
      return norm === prefix || norm.startsWith(prefix + "/");
    }
    if (p.endsWith("/*")) {
      const prefix = p.slice(0, -2);
      if (!norm.startsWith(prefix + "/")) return false;
      const rest = norm.slice(prefix.length + 1);
      return rest.length > 0 && !rest.includes("/");
    }
    if (p.includes("*")) {
      const re = new RegExp(
        "^" +
          p
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, ".*")
            .replace(/\*/g, "[^/]*") +
          "$",
      );
      return re.test(norm);
    }
    return norm === p;
  });
}

function pickTargetFile(ctx: AgentActContext): string {
  // Prefer a whitelist path under src/, else safe demo file.
  const preferred = ["src/sightloop-fix.txt", "src/App.tsx", "README.md"];
  for (const cand of preferred) {
    if (matchesWhitelist(cand, ctx.fileWhitelist)) return cand;
  }
  if (ctx.fileWhitelist[0]) {
    const w = ctx.fileWhitelist[0].replace(/\/\*\*?$/, "");
    return join(w || "src", "sightloop-fix.txt");
  }
  return "src/sightloop-fix.txt";
}

/**
 * Dry-run / no-API-key runner: makes a small whitelist-safe edit so
 * Accept / Refine / Revert can be demoed end-to-end without cloud LLM.
 */
export function createMockRunner(): AgentRunner {
  return {
    name: "mock",
    async act(ctx: AgentActContext): Promise<AgentActResult> {
      let rel = pickTargetFile(ctx).replace(/\\/g, "/");
      if (ctx.planAllowedFiles?.length) {
        // Prefer first plan file that also matches project whitelist.
        const hit = ctx.planAllowedFiles.find((f) =>
          matchesWhitelist(f, ctx.fileWhitelist),
        );
        if (!hit) {
          throw new Error(
            `plan_whitelist_blocked: no PlanIR.allowed_files within project whitelist`,
          );
        }
        rel = hit.replace(/\\/g, "/");
        if (!ctx.planAllowedFiles.includes(rel)) {
          throw new Error(`plan_whitelist_blocked: ${rel}`);
        }
      }
      if (!matchesWhitelist(rel, ctx.fileWhitelist)) {
        throw new Error(
          `mock runner refused path outside whitelist: ${rel}`,
        );
      }
      const abs = resolve(ctx.repoPath, rel);
      const repoReal = resolve(ctx.repoPath);
      if (!abs.startsWith(repoReal + "/") && abs !== repoReal) {
        throw new Error("path escape blocked in mock runner");
      }
      if (isAbsolute(rel)) {
        throw new Error("absolute paths not allowed");
      }

      mkdirSync(dirname(abs), { recursive: true });
      const note =
        ctx.annotation?.note ||
        ctx.refineNote ||
        "SightLoop mock fix";
      const selector = ctx.annotation?.selector ?? "(none)";
      const stamp = new Date().toISOString();

      let next: string;
      if (existsSync(abs) && abs.endsWith(".tsx")) {
        const prev = readFileSync(abs, "utf8");
        const marker = `/* sightloop-mock:${ctx.sessionId.slice(0, 8)} */`;
        if (prev.includes(marker)) {
          next = prev;
        } else {
          next = `${prev.trimEnd()}\n\n${marker}\n`;
        }
      } else {
        next = [
          `# SightLoop mock agent edit`,
          `session: ${ctx.sessionId}`,
          `at: ${stamp}`,
          `page: ${ctx.pageUrl}`,
          `selector: ${selector}`,
          `note: ${note}`,
          `knowledge_hits: ${ctx.knowledgeStub.length}`,
          "",
        ].join("\n");
      }
      writeFileSync(abs, next, "utf8");

      return {
        summary: `Mock runner edited ${rel} (dry-run / no LLM key)`,
        stepsUsed: 1,
        filesTouched: [relative(repoReal, abs).replace(/\\/g, "/")],
        dryRun: true,
        runner: "mock",
        detail: { note, selector },
      };
    },
  };
}
