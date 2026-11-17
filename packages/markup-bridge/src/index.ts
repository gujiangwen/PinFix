export type {
  AnnotationSessionMeta,
  AnnotationSessionDetail,
  WriteAnnotationInput,
  MarkupTools,
  MarkupAdapterKind,
} from "./types.js";

export {
  writeAnnotationWorkspace,
  listWorkspaceSessions,
  readWorkspaceSession,
  readLatestWorkspaceSession,
} from "./workspace.js";

export { createSelfMarkupTools } from "./adapters/self.js";
export {
  createOfficialMarkupTools,
  type OfficialAdapterOptions,
} from "./adapters/official.js";

import type { MarkupAdapterKind, MarkupTools } from "./types.js";
import { createSelfMarkupTools } from "./adapters/self.js";
import { createOfficialMarkupTools } from "./adapters/official.js";

export type CreateMarkupToolsOptions = {
  workspaceDir: string;
  /** Default `self`. Set `official` (or MARKUP_ADAPTER=official) to prefer official path. */
  adapter?: MarkupAdapterKind;
  licenseKey?: string;
  probeOfficial?: boolean;
};

/** Dual-adapter factory — self-built by default; official is opt-in. */
export function createMarkupTools(
  opts: CreateMarkupToolsOptions,
): MarkupTools {
  const fromEnv = (process.env.MARKUP_ADAPTER ?? "").toLowerCase();
  const kind: MarkupAdapterKind =
    opts.adapter ??
    (fromEnv === "official" ? "official" : "self");

  if (kind === "official") {
    return createOfficialMarkupTools({
      workspaceDir: opts.workspaceDir,
      licenseKey: opts.licenseKey ?? process.env.MARKUP_LICENSE_KEY,
      probe: opts.probeOfficial ?? process.env.MARKUP_MCP_ENABLED === "1",
    });
  }
  return createSelfMarkupTools(opts.workspaceDir);
}
