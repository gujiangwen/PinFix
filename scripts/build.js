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
const names = ["bridge.js", "widget.js", "popup.html", "popup.js", "icon-192.png"];

for (const browser of browsers) {
  const output = path.join(root, "dist", browser);
  await mkdir(output, { recursive: true });
  await Promise.all(names.map((name) => cp(path.join(sourceDir, name), path.join(output, name))));
  const manifest = manifestFor(sourceManifest, browser);
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`built dist/${browser}`);
}
