import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const popupJs = await readFile(path.join(root, "src/popup.js"), "utf8");
const popupHtml = await readFile(path.join(root, "src/popup.html"), "utf8");

test("popup checks latest release and compares versions", () => {
  assert.match(popupJs, /releases\/latest/);
  assert.match(popupJs, /compareVersions/);
  assert.match(popupJs, /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(popupJs, /AbortController/);
});

test("update banner hidden by default and links to release", () => {
  assert.match(popupHtml, /id="update"/);
  assert.match(popupHtml, /data-show="false"/);
  assert.match(popupJs, /updateBtn\.dataset\.url/);
  assert.match(popupJs, /chrome\.tabs\.create/);
});
