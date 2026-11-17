import { spawn } from "node:child_process";
import type { MarkupTools } from "../types.js";
import { createSelfMarkupTools } from "./self.js";

export type OfficialAdapterOptions = {
  workspaceDir: string;
  /** When true, spawn `npx -y markup-mcp` briefly to verify availability (best-effort). */
  probe?: boolean;
  licenseKey?: string;
};

/**
 * Optional official `markup-mcp` adapter.
 *
 * Official MCP exposes tools over stdio; for M3 we keep the same MarkupTools
 * surface and read the shared workspace directory (written by SightLoop).
 * When MARKUP_MCP_ENABLED=1 we optionally probe that `markup-mcp` is runnable;
 * tool semantics still go through the compatible workspace reader so Retrieve
 * works without a Pro license.
 */
export function createOfficialMarkupTools(
  opts: OfficialAdapterOptions,
): MarkupTools {
  const self = createSelfMarkupTools(opts.workspaceDir);

  if (opts.probe) {
    void probeMarkupMcp(opts).catch(() => {
      /* best-effort */
    });
  }

  return {
    async listAnnotationSessions() {
      return self.listAnnotationSessions();
    },
    async getLatestAnnotations() {
      return self.getLatestAnnotations();
    },
    async getAnnotationSession(id: string) {
      return self.getAnnotationSession(id);
    },
  };
}

function probeMarkupMcp(opts: OfficialAdapterOptions): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "npx",
      ["-y", "markup-mcp", "--help"],
      {
        env: {
          ...process.env,
          MARKUP_WORKSPACE: opts.workspaceDir,
          ...(opts.licenseKey
            ? { MARKUP_LICENSE_KEY: opts.licenseKey }
            : {}),
        },
        stdio: "ignore",
      },
    );
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise(false);
    }, 8_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolvePromise(false);
    });
  });
}
