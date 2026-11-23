import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widget = await readFile(path.join(root, "src/widget.js"), "utf8");

test("clipboard write includes plain text, html with text, and image", () => {
  assert.match(widget, /text\/plain.*text/s);
  assert.match(widget, /text\/html/);
  assert.match(widget, /image\/png/);
  assert.match(widget, /ClipboardItem/);
});

test("html payload carries prompt text and inline screenshot", () => {
  assert.match(widget, /escapeHtml\(text\)/);
  assert.match(widget, /<img src=/);
});
