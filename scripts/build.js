import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BROWSERS = ["chromium", "firefox", "safari"];

export function manifestFor(source, browser) {
  if (!BROWSERS.includes(browser)) throw new Error(`不支持的浏览器：${browser}`);
  const manifest = JSON.parse(source);
  if (browser === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: "annotator@pinfix.local",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] },
      },
    };
  }
  if (browser === "safari") {
    manifest.browser_specific_settings = { safari: { strict_min_version: "18.0" } };
  }
  return manifest;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : BROWSERS;
const sourceDir = path.join(root, "src");
const sourceManifest = await readFile(path.join(sourceDir, "manifest.json"), "utf8");
// prompt-core.js 是 buildPrompt 的单一事实来源，仅供 node:test 引用；widget.js 内联同一份实现，避免 content script module 化带来的启动时序问题
const names = ["bridge.js", "widget.js", "popup.html", "popup.js", "options.html", "options.js", "icon-192.png"];
const workerNames = ["background.js"];

for (const browser of browsers) {
  const output = path.join(root, "dist", browser);
  await mkdir(output, { recursive: true });
  await Promise.all(names.map((name) => cp(path.join(sourceDir, name), path.join(output, name))));
  const manifest = manifestFor(sourceManifest, browser);
  if (browser === "firefox") {
    await Promise.all(workerNames.map((name) => cp(path.join(sourceDir, name), path.join(output, name))));
    manifest.background = { scripts: workerNames };
  } else {
    await Promise.all(workerNames.map((name) => cp(path.join(sourceDir, name), path.join(output, name))));
    manifest.background = { service_worker: "background.js" };
  }
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`built dist/${browser}`);
}
