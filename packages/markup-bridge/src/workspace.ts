import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type {
  AnnotationSessionDetail,
  AnnotationSessionMeta,
  WriteAnnotationInput,
} from "./types.js";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeSlug(slug: string): string {
  const cleaned = slug
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "annotation";
}

function buildMarkdown(input: {
  pageUrl: string;
  note?: string;
  selector?: string;
  sniff?: unknown;
  createdAt: string;
  slug: string;
}): string {
  const lines = [
    `# SightLoop annotation — ${input.slug}`,
    "",
    `- **created_at:** ${input.createdAt}`,
    `- **page_url:** ${input.pageUrl}`,
  ];
  if (input.selector) lines.push(`- **selector:** \`${input.selector}\``);
  if (input.note) {
    lines.push("", "## Notes", "", input.note);
  }
  if (input.sniff != null) {
    lines.push(
      "",
      "## Sniff",
      "",
      "```json",
      JSON.stringify(input.sniff, null, 2).slice(0, 8000),
      "```",
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Write MarkUp-compatible workspace files:
 * `YYYY-MM-DD_<slug>_annotations.md` (+ optional `.png`).
 */
export function writeAnnotationWorkspace(
  input: WriteAnnotationInput,
): AnnotationSessionMeta {
  const workspaceDir = resolve(input.workspaceDir);
  mkdirSync(workspaceDir, { recursive: true });

  const date = input.date ?? todayUtc();
  const slug = sanitizeSlug(input.slug);
  const id = `${date}_${slug}`;
  const mdName = `${id}_annotations.md`;
  const pngName = `${id}_annotations.png`;
  const mdPath = join(workspaceDir, mdName);
  const createdAt = new Date().toISOString();

  const markdown = buildMarkdown({
    pageUrl: input.pageUrl,
    note: input.note,
    selector: input.selector,
    sniff: input.sniff,
    createdAt,
    slug,
  });
  writeFileSync(mdPath, markdown, "utf8");

  let pngPath: string | null = null;
  if (input.png && input.png.byteLength > 0) {
    pngPath = join(workspaceDir, pngName);
    writeFileSync(pngPath, input.png);
  }

  return {
    id,
    slug,
    created_at: createdAt,
    page_url: input.pageUrl,
    selector: input.selector,
    note: input.note,
    md_path: mdPath,
    png_path: pngPath,
  };
}

function parseStem(filename: string): string | null {
  const m = filename.match(/^(.+)_annotations\.md$/);
  return m?.[1] ?? null;
}

function metaFromStem(
  workspaceDir: string,
  id: string,
): AnnotationSessionMeta | null {
  const mdPath = join(workspaceDir, `${id}_annotations.md`);
  if (!existsSync(mdPath)) return null;
  const pngCandidate = join(workspaceDir, `${id}_annotations.png`);
  const png_path = existsSync(pngCandidate) ? pngCandidate : null;

  let page_url: string | undefined;
  let selector: string | undefined;
  let note: string | undefined;
  let created_at = "";
  try {
    const md = readFileSync(mdPath, "utf8");
    created_at =
      md.match(/\*\*created_at:\*\*\s*(.+)/)?.[1]?.trim() ??
      new Date(0).toISOString();
    page_url = md.match(/\*\*page_url:\*\*\s*(.+)/)?.[1]?.trim();
    selector = md
      .match(/\*\*selector:\*\*\s*`([^`]+)`/)?.[1]
      ?.trim();
    const noteMatch = md.match(/## Notes\s*\n\n([\s\S]*?)(?:\n## |\n*$)/);
    if (noteMatch?.[1]) note = noteMatch[1].trim();
  } catch {
    created_at = new Date(0).toISOString();
  }

  const slug = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  return {
    id,
    slug,
    created_at,
    page_url,
    selector,
    note,
    md_path: mdPath,
    png_path,
  };
}

export function listWorkspaceSessions(
  workspaceDir: string,
): AnnotationSessionMeta[] {
  const dir = resolve(workspaceDir);
  if (!existsSync(dir)) return [];
  const ids = readdirSync(dir)
    .map(parseStem)
    .filter((x): x is string => Boolean(x));
  const metas = ids
    .map((id) => metaFromStem(dir, id))
    .filter((m): m is AnnotationSessionMeta => m != null);
  return metas.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function readWorkspaceSession(
  workspaceDir: string,
  id: string,
): AnnotationSessionDetail | null {
  const meta = metaFromStem(resolve(workspaceDir), id);
  if (!meta) return null;
  const markdown = readFileSync(meta.md_path, "utf8");
  return { ...meta, markdown };
}

export function readLatestWorkspaceSession(
  workspaceDir: string,
): AnnotationSessionDetail | null {
  const list = listWorkspaceSessions(workspaceDir);
  const first = list[0];
  if (!first) return null;
  return readWorkspaceSession(workspaceDir, first.id);
}
