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

test("update check runs at most once per day", () => {
  assert.match(popupJs, /updateCheckedAt/);
  assert.match(popupJs, /chrome\.storage\.local\.get\("updateCheckedAt"\)/);
  assert.match(popupJs, /chrome\.storage\.local\.set\(\{ updateCheckedAt/);
});

test("update banner hidden by default and links to release", () => {
  assert.match(popupHtml, /id="update"/);
  assert.match(popupHtml, /data-show="false"/);
  assert.match(popupJs, /updateBtn\.dataset\.url/);
  assert.match(popupJs, /chrome\.tabs\.create/);
});

test("popup surfaces shortcut conflict with fix entry", () => {
  assert.match(popupHtml, /shortcut-hint/);
  assert.match(popupHtml, /shortcut-fix/);
  assert.match(popupJs, /chrome\.commands\.getAll/);
  assert.match(popupJs, /快捷键未生效 · 点击设置/);
  assert.match(popupJs, /extensions\/shortcuts/);
});
