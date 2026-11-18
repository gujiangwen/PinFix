import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import type { Knowledge, Project } from "@sightloop/shared";
import { assertAllowedRepoPath } from "./path-guard.js";

const MARKER_BEGIN = "<!-- sightloop:knowledge:begin -->";
const MARKER_END = "<!-- sightloop:knowledge:end -->";

function isAgentsMdAllowed(project: Project): boolean {
  const whitelist = project.file_whitelist ?? [];
  if (whitelist.length === 0) return true;
  return whitelist.some((g) => {
    const n = g.replace(/^\.\//, "");
    return (
      n === "AGENTS.md" ||
      n === "*" ||
      n === "**" ||
      n === "**/*" ||
      n.endsWith("/AGENTS.md") ||
      n === "*.md" ||
      n === "**/*.md"
    );
  });
}

function underRepo(repoPath: string, filePath: string): boolean {
  const rel = relative(resolve(repoPath), resolve(filePath));
  return rel === "AGENTS.md";
}

export function buildAgentsMdSuggestion(cards: Knowledge[]): string {
  const lines = [
    MARKER_BEGIN,
    "",
    "## SightLoop distilled knowledge",
    "",
    "_Synced from SightLoop Knowledge Hub. Edit cards in Admin; re-sync to refresh this block._",
    "",
  ];
  for (const k of cards) {
    lines.push(`### ${k.title}`);
    lines.push("");
    lines.push(`- kind: \`${k.kind}\``);
    if (k.stack) lines.push(`- stack: \`${k.stack}\``);
    if (k.tags.length) lines.push(`- tags: ${k.tags.map((t) => `\`${t}\``).join(", ")}`);
    lines.push("");
    lines.push(k.body_md.trim());
    lines.push("");
  }
  lines.push(MARKER_END);
  lines.push("");
  return lines.join("\n");
}

export function mergeAgentsMd(existing: string, block: string): string {
  if (!existing.includes(MARKER_BEGIN) || !existing.includes(MARKER_END)) {
    const base = existing.trimEnd();
    return `${base ? `${base}\n\n` : ""}${block}`;
  }
  const before = existing.slice(0, existing.indexOf(MARKER_BEGIN));
  const after = existing.slice(
    existing.indexOf(MARKER_END) + MARKER_END.length,
  );
  return `${before.trimEnd()}\n\n${block}${after.replace(/^\n*/, "")}`;
}

export type SyncAgentsResult = {
  path: string;
  wrote: boolean;
  dry_run: boolean;
  bytes: number;
  markdown: string;
  knowledge_ids: string[];
};

export function syncKnowledgeToAgentsMd(input: {
  project: Project;
  cards: Knowledge[];
  allowedRoots: string[];
  dryRun?: boolean;
}): SyncAgentsResult {
  const check = assertAllowedRepoPath(input.project.repo_path, input.allowedRoots);
  if (!check.ok) {
    throw Object.assign(new Error(check.message), { code: check.code });
  }
  if (!isAgentsMdAllowed(input.project)) {
    throw Object.assign(
      new Error(
        "AGENTS.md is not covered by project file_whitelist — add AGENTS.md or *.md",
      ),
      { code: "whitelist_blocked" },
    );
  }

  const target = join(check.realPath, "AGENTS.md");
  if (!underRepo(check.realPath, target)) {
    throw Object.assign(new Error("AGENTS.md path escaped repo_path"), {
      code: "path_escape_blocked",
    });
  }

  const block = buildAgentsMdSuggestion(input.cards);
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const next = mergeAgentsMd(existing, block);
  const dryRun = Boolean(input.dryRun);

  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, next, "utf8");
  }

  return {
    path: target,
    wrote: !dryRun,
    dry_run: dryRun,
    bytes: Buffer.byteLength(next, "utf8"),
    markdown: next,
    knowledge_ids: input.cards.map((c) => c.id),
  };
}
