import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { findMonorepoRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

export type ExtensionInstallInfo = {
  built: boolean;
  container_dist: string;
  host_dist: string | null;
  manifest_version: number | null;
  name: string | null;
  version: string | null;
  zip_available: boolean;
  chrome_allows: {
    silent_force_install: false;
    load_unpacked: true;
    web_pages_open_chrome_extensions: false;
    crx_from_http: false;
  };
  steps: {
    en: string[];
    zh: string[];
  };
};

function distDir(): string {
  return resolve(findMonorepoRoot(), "apps/extension/dist");
}

function readManifest(dist: string): {
  manifest_version: number | null;
  name: string | null;
  version: string | null;
} {
  const mf = join(dist, "manifest.json");
  if (!existsSync(mf)) {
    return { manifest_version: null, name: null, version: null };
  }
  try {
    const j = JSON.parse(readFileSync(mf, "utf8")) as {
      manifest_version?: number;
      name?: string;
      version?: string;
    };
    return {
      manifest_version: j.manifest_version ?? null,
      name: j.name ?? null,
      version: j.version ?? null,
    };
  } catch {
    return { manifest_version: null, name: null, version: null };
  }
}

export function getExtensionInstallInfo(): ExtensionInstallInfo {
  const container_dist = distDir();
  const built =
    existsSync(container_dist) && existsSync(join(container_dist, "manifest.json"));
  const hostDistEnv = process.env.SIGHTLOOP_HOST_EXTENSION_DIST?.trim();
  const hostRepo = process.env.SIGHTLOOP_HOST_REPO?.trim();
  const host_dist =
    hostDistEnv ||
    (hostRepo ? join(hostRepo, "apps", "extension", "dist") : null);
  const mf = built ? readManifest(container_dist) : {
    manifest_version: null,
    name: null,
    version: null,
  };

  const pathForSteps = host_dist || container_dist;

  return {
    built,
    container_dist,
    host_dist,
    ...mf,
    zip_available: built,
    chrome_allows: {
      silent_force_install: false,
      load_unpacked: true,
      web_pages_open_chrome_extensions: false,
      crx_from_http: false,
    },
    steps: {
      en: [
        "Click “Build extension” if not built, then “Download ZIP” (or copy the host folder path).",
        "Unzip to a stable folder (or use the repo apps/extension/dist path).",
        "Open Chrome → chrome://extensions (paste into the address bar — pages cannot open it).",
        "Enable Developer mode → Load unpacked → select the dist folder:",
        pathForSteps,
      ],
      zh: [
        "若未构建，先点「构建扩展」，再「下载 ZIP」（或复制本机文件夹路径）。",
        "解压到固定目录（或直接使用仓库 apps/extension/dist）。",
        "打开 Chrome → 地址栏输入 chrome://extensions（网页无法直接跳转该页）。",
        "打开「开发者模式」→「加载已解压的扩展程序」→ 选择 dist 目录：",
        pathForSteps,
      ],
    },
  };
}

export async function buildExtension(): Promise<{
  ok: boolean;
  dist: string;
  log_tail: string;
}> {
  const root = findMonorepoRoot();
  const dist = distDir();
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["--filter", "@sightloop/extension", "build"],
      {
        cwd: root,
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
        shell: true,
      },
    );
    const log = `${stdout}\n${stderr}`.trim();
    return {
      ok: existsSync(join(dist, "manifest.json")),
      dist,
      log_tail: log.slice(-4000),
    };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const log = `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`.trim();
    return { ok: false, dist, log_tail: log.slice(-4000) };
  }
}

export function createExtensionZip(): {
  path: string;
  bytes: number;
  filename: string;
} {
  const dist = distDir();
  if (!existsSync(join(dist, "manifest.json"))) {
    throw new Error("Extension not built — call POST /v1/admin/extension/build first");
  }
  const outDir = resolve(findMonorepoRoot(), "data/extension-artifacts");
  mkdirSync(outDir, { recursive: true });
  const filename = `sightloop-extension-${Date.now()}.zip`;
  const outPath = join(outDir, filename);

  // Prefer python zipfile (available in our Docker image); fallback to PowerShell on Windows host.
  try {
    execFileSync(
      "python3",
      ["-m", "zipfile", "-c", outPath, "."],
      { cwd: dist, stdio: "pipe" },
    );
  } catch {
    try {
      execFileSync(
        "python",
        ["-m", "zipfile", "-c", outPath, "."],
        { cwd: dist, stdio: "pipe" },
      );
    } catch {
      // Windows host without python3 alias
      const ps = `Compress-Archive -Path (Join-Path '${dist.replace(/'/g, "''")}' '*') -DestinationPath '${outPath.replace(/'/g, "''")}' -Force`;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], {
        stdio: "pipe",
      });
    }
  }

  const bytes = statSync(outPath).size;
  return { path: outPath, bytes, filename };
}

export function readExtensionZip(path: string): Buffer {
  return readFileSync(path);
}
