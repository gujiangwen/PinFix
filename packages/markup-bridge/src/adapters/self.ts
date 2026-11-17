import type { MarkupTools } from "../types.js";
import {
  listWorkspaceSessions,
  readLatestWorkspaceSession,
  readWorkspaceSession,
} from "../workspace.js";

/** Self-built MarkupTools — reads the same workspace file contract as MarkUp. */
export function createSelfMarkupTools(workspaceDir: string): MarkupTools {
  return {
    async listAnnotationSessions() {
      return listWorkspaceSessions(workspaceDir);
    },
    async getLatestAnnotations() {
      return readLatestWorkspaceSession(workspaceDir);
    },
    async getAnnotationSession(id: string) {
      return readWorkspaceSession(workspaceDir, id);
    },
  };
}
