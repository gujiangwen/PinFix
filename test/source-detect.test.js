import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widget = await readFile(path.join(root, "src/widget.js"), "utf8");

test("widget detects React fiber debug source", () => {
  assert.match(widget, /__reactFiber\$/);
  assert.match(widget, /_debugSource/);
  assert.match(widget, /fileName/);
  assert.match(widget, /lineNumber/);
  assert.match(widget, /fiber\.return/);
});

test("widget keeps Vue component detection", () => {
  assert.match(widget, /__vueParentComponent/);
  assert.match(widget, /type\?\.type\?\.|__file/);
});

test("component chain covers React displayName and Vue file names", () => {
  assert.match(widget, /displayName/);
  assert.match(widget, /componentChain/);
});

test("anchor line falls back to React debug line number", () => {
  assert.match(widget, /componentLine\(element\)/);
});
