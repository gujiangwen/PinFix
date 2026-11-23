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
    assert.ok(manifest.background, `${browser} has background`);
    const bgFiles = browser === "firefox" ? manifest.background.scripts : [manifest.background.service_worker];
    for (const file of [...new Set(scripts), ...bgFiles, "popup.html", "popup.js", "options.html", "options.js", "icon-192.png"]) {
      assert.ok((await stat(path.join(output, file))).isFile(), `${browser}/${file}`);
    }
    assert.equal(manifest.commands?.["toggle-annotation"]?.suggested_key?.default, "Alt+Shift+P");
    assert.equal(manifest.options_ui?.page, "options.html");
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

test("screenshot flow wires annotate entry, bridge and prompt", async () => {
  const background = await readFile(path.join(root, "dist/chromium/background.js"), "utf8");
  const bridge = await readFile(path.join(root, "dist/chromium/bridge.js"), "utf8");
  const widget = await readFile(path.join(root, "dist/chromium/widget.js"), "utf8");
  const optionsJs = await readFile(path.join(root, "dist/chromium/options.js"), "utf8");
  const optionsHtml = await readFile(path.join(root, "dist/chromium/options.html"), "utf8");
  const popupHtml = await readFile(path.join(root, "dist/chromium/popup.html"), "utf8");
  const popupJs = await readFile(path.join(root, "dist/chromium/popup.js"), "utf8");
  assert.match(background, /captureVisibleTab/);
  assert.match(bridge, /pinfix-capture-request/);
  assert.match(bridge, /pinfixShot/);
  assert.doesNotMatch(bridge, /pinfixSettings/);
  assert.match(widget, /captureScreenshot/);
  assert.match(widget, /drawScreenshot/);
  assert.match(widget, /ClipboardItem/);
  assert.match(widget, /copyTextAndImage/);
  assert.match(widget, /wantShot/);
  assert.doesNotMatch(optionsHtml, /screenshot-enabled/);
  assert.doesNotMatch(optionsJs, /settings\.screenshot/);
  assert.match(popupHtml, /id="annotate-shot"/);
  assert.match(popupJs, /screenshot: withScreenshot/);
});

test("popup does not depend on removed generated defaults", async () => {
  const html = await readFile(path.join(root, "dist/chromium/popup.html"), "utf8");
  const popupJs = await readFile(path.join(root, "dist/chromium/popup.js"), "utf8");
  assert.match(html, /<title>PinFix 页面标注<\/title>/);
  assert.doesNotMatch(html, /defaults\.js|SIGHTLOOP_DEFAULTS/);
  assert.equal(JSON.parse(source).name, "PinFix 页面标注");
  assert.match(html, /id="settings"/);
  assert.match(popupJs, /openOptionsPage/);
});

test("popup auto reloads page when content script is missing", async () => {
  const popupJs = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.match(popupJs, /tabs\.reload\(tab\.id\)/);
  assert.match(popupJs, /正在刷新页面，稍后自动开始标注/);
  assert.match(popupJs, /pickAfterLoad:/);
  assert.doesNotMatch(popupJs, /请刷新目标页面后标注/);
});

test("popup uses compact segmented annotate control", async () => {
  const html = await readFile(path.join(root, "src/popup.html"), "utf8");
  const popupJs = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.match(html, /id="annotate-group"/);
  assert.match(html, /#annotate-group > #annotate \{ flex: 1/);
  assert.match(html, /id="status-text"/);
  assert.match(popupJs, /#status-text/);
});

test("picking shows clickable crumbs hint and crumbs are interactive", async () => {
  const widget = await readFile(path.join(root, "src/widget.js"), "utf8");
  assert.match(widget, /pick-hint/);
  assert.match(widget, /调整层级 · Enter 确认/);
  assert.match(widget, /crumbs button:hover.*cursor: pointer|cursor: pointer/s);
  assert.match(widget, /button\.addEventListener\("click"[\s\S]*?selectElement\(node\)/);
});

test("draft submission resumes picking and reports screenshot fallback", async () => {
  const widget = await readFile(path.join(root, "src/widget.js"), "utf8");
  assert.match(widget, /function hideDraftAndResume\(\)[\s\S]*?setPicking\(true\)/);
  assert.match(widget, /截图不可用，已仅复制文字提示词，粘贴给智能体即可/);
  assert.match(widget, /已复制提示词与截图，粘贴给智能体即可/);
  assert.match(widget, /截图并复制/);
  assert.match(widget, /请先描述问题/);
});

test("welcome page is bundled and opened on install", async () => {
  const background = await readFile(path.join(root, "src/background.js"), "utf8");
  const output = path.join(root, "dist/chromium/welcome.html");
  assert.match(background, /onInstalled/);
  assert.match(background, /welcome\.html/);
  assert.ok((await stat(output)).isFile());
  const welcome = await readFile(output, "utf8");
  assert.match(welcome, /固定到工具栏/);
  assert.match(welcome, /Alt\+Shift\+P/);
});

test("bridge resumes picking after popup-triggered reload", async () => {
  const bridge = await readFile(path.join(root, "src/bridge.js"), "utf8");
  assert.match(bridge, /pickAfterLoad/);
  assert.match(bridge, /storage\.session/);
  const manifest = JSON.parse(await readFile(path.join(root, "dist/chromium/manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("scripting"));
});
