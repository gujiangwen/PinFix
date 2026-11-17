import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./client.js";
import { migrate } from "./migrate.js";
import { createProject } from "./projects.js";
import { insertKnowledge, matchKnowledgeForRetrieve } from "./knowledge.js";
import { isVecReady, searchKnowledgeVec } from "./vectors.js";
import { embedText } from "./embed.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("embed + sqlite-vec", () => {
  it("normalizes local embeddings", () => {
    const a = embedText("ProductCard CTA contrast");
    const b = embedText("ProductCard CTA contrast");
    expect(a.length).toBe(256);
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
    expect(dot).toBeGreaterThan(0.99);
  });

  it("indexes knowledge and retrieves by similarity before text-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-vec-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "t.sqlite"));
    migrate(db);
    expect(isVecReady()).toBe(true);

    const project = createProject(db, {
      name: "vec",
      repo_path: dir,
      origin_pattern: "http://localhost/*",
      mode: "hmr",
    });

    const card = insertKnowledge(db, {
      project_id: project.id,
      kind: "pattern",
      title: "ProductCard CTA contrast",
      body_md: "Use higher contrast on the buy button for ProductCard.",
      tags: ["ProductCard", "cta"],
      stack: "react",
      pinned: true,
    });
    expect(card.embedding_ref).toMatch(/^sqlite-vec:/);

    insertKnowledge(db, {
      project_id: project.id,
      kind: "anti_pattern",
      title: "Unrelated CSS reset",
      body_md: "Never reset box-sizing globally in vendor packages.",
      tags: ["css"],
      stack: "react",
    });

    const hits = searchKnowledgeVec(
      db,
      {
        selector: '[data-testid="product-Aurora Lamp"]',
        note: "CTA contrast on ProductCard",
        componentNames: ["ProductCard"],
        stack: "react",
      },
      5,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.knowledge_id).toBe(card.id);

    const matched = matchKnowledgeForRetrieve(
      db,
      project.id,
      {
        selector: '[data-testid="product-Aurora Lamp"]',
        note: "make CTA clearer on ProductCard",
        componentNames: ["ProductCard"],
      },
      5,
    );
    expect(matched[0]!.id).toBe(card.id);
    expect(matched[0]!.retrieve).toMatch(/sqlite-vec/);
    db.close();
  });
});
