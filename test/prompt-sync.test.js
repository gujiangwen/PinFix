import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("widget inlines the same buildPrompt logic as prompt-core", async () => {
  const core = await readFile(path.join(root, "src/prompt-core.js"), "utf8");
  const widget = await readFile(path.join(root, "src/widget.js"), "utf8");
  const coreBody = core.replace(/^export function buildPrompt/, "function buildPrompt").trim();
  const coreLines = coreBody.split("\n").map((l) => l.trim()).filter(Boolean);
  const missing = coreLines.filter((line) => line.length > 10 && !widget.includes(line));
  assert.deepEqual(missing, [], "widget.js buildPrompt drifted from prompt-core.js");
});
