import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BROWSERS, manifestFor } from "../scripts/build.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "src/manifest.json"), "utf8");

test("build emits self-contained packages for all browsers", async () => {
  for (const browser of BROWSERS) {
    const output = path.join(root, "dist", browser);
    const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js);
    assert.deepEqual(scripts, ["bridge.js", "widget.js"]);
    assert.equal(manifest.content_scripts[1].world, "MAIN");
    for (const file of [...new Set(scripts), "popup.html", "popup.js", "icon-192.png"]) {
      assert.ok((await stat(path.join(output, file))).isFile(), `${browser}/${file}`);
    }
    assert.equal(manifestFor(source, browser).manifest_version, 3);
  }
});

test("browser manifests carry only their required settings", () => {
  assert.equal(manifestFor(source, "chromium").browser_specific_settings, undefined);
  const firefox = manifestFor(source, "firefox").browser_specific_settings.gecko;
  assert.equal(firefox.id, "annotator@pinfix.local");
  assert.equal(firefox.strict_min_version, "128.0");
  assert.deepEqual(firefox.data_collection_permissions.required, ["none"]);
  assert.equal(manifestFor(source, "safari").browser_specific_settings.safari.strict_min_version, "18.0");
  assert.throws(() => manifestFor(source, "ie"), /不支持的浏览器/);
});

test("standalone build has no baked-in service credentials", async () => {
  const bridge = await readFile(path.join(root, "dist/chromium/bridge.js"), "utf8");
  const widget = await readFile(path.join(root, "dist/chromium/widget.js"), "utf8");
  assert.doesNotMatch(bridge, /localhost:7788|dev-local-token|sightloopConsole\s*=/);
  assert.match(widget, /buildPrompt/);
  assert.match(widget, /navigator\.clipboard\.writeText/);
});

test("popup does not depend on removed generated defaults", async () => {
  const html = await readFile(path.join(root, "dist/chromium/popup.html"), "utf8");
  assert.match(html, /<title>PinFix 页面标注<\/title>/);
  assert.doesNotMatch(html, /defaults\.js|SIGHTLOOP_DEFAULTS/);
  assert.equal(JSON.parse(source).name, "PinFix 页面标注");
});
