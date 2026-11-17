import type {
  ExtensionSettings,
  RuntimeResponse,
} from "../shared/protocol";
import { DEFAULT_SETTINGS } from "../shared/protocol";

const daemonUrl = document.getElementById("daemonUrl") as HTMLInputElement;
const token = document.getElementById("token") as HTMLInputElement;
const projectId = document.getElementById("projectId") as HTMLSelectElement;
const repoPath = document.getElementById("repoPath") as HTMLInputElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const summaryLine = document.getElementById("summaryLine") as HTMLParagraphElement;
const runnerBadge = document.getElementById("runnerBadge") as HTMLSpanElement;

function setStatus(msg: string): void {
  status.textContent = msg;
}

function setLight(key: string, ok: boolean | null): void {
  const el = document.querySelector(`.light[data-k="${key}"]`);
  if (!el) return;
  el.classList.remove("ok", "bad");
  if (ok === true) el.classList.add("ok");
  if (ok === false) el.classList.add("bad");
}

async function send(message: unknown): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

function readForm(): ExtensionSettings {
  return {
    daemonUrl: daemonUrl.value.trim() || DEFAULT_SETTINGS.daemonUrl,
    token: token.value.trim() || DEFAULT_SETTINGS.token,
    projectId: projectId.value,
  };
}

function applyRunner(dx: {
  runner?: { mode?: string; reason?: string; llm_key_present?: boolean };
} | null): void {
  const mode = dx?.runner?.mode ?? "…";
  runnerBadge.textContent = `Runner: ${mode}`;
  runnerBadge.classList.remove("mock", "pi");
  if (mode === "mock" || mode === "pi") runnerBadge.classList.add(mode);
  const reason = dx?.runner?.reason ?? "";
  runnerBadge.title =
    mode === "pi"
      ? `真实 pi（${reason}）。密钥仅在 Daemon 环境变量。`
      : `mock：完整 Accept/Refine/Revert 可演示，不调用云端（${reason}）。`;
}

async function refreshProjects(selectId?: string): Promise<void> {
  await send({ type: "save_settings", settings: readForm() });
  const res = await send({ type: "list_projects" });
  if (!res.ok) {
    setLight("project", false);
    setStatus(`Projects: ${res.error}`);
    return;
  }
  const projects =
    (
      res.data as {
        projects?: Array<{ id: string; name: string; repo_path: string }>;
      }
    ).projects ?? [];
  projectId.innerHTML = "";
  if (projects.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "尚无项目 — 点「一键准备 Demo」";
    projectId.appendChild(opt);
    setLight("project", false);
    return;
  }
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.id.slice(0, 8)}…)`;
    projectId.appendChild(opt);
  }
  const preferred = selectId || readForm().projectId;
  if (preferred && projects.some((p) => p.id === preferred)) {
    projectId.value = preferred;
  }
  setLight("project", Boolean(projectId.value));
}

async function discover(): Promise<void> {
  setStatus("正在探测本机 Daemon…");
  const res = await send({ type: "discover_daemon" });
  if (!res.ok) {
    setLight("daemon", false);
    setLight("token", null);
    setLight("project", null);
    applyRunner(null);
    summaryLine.textContent = "未找到 Daemon — 先跑 pnpm dev:daemon";
    setStatus(res.error);
    return;
  }
  const data = res.data as {
    daemonUrl: string;
    health: { version?: string };
    dx: {
      auth?: { token_configured?: boolean; dx_bootstrap_enabled?: boolean };
      runner?: { mode?: string; reason?: string };
      projects?: { count?: number; fixture_project_id?: string | null };
    } | null;
  };
  daemonUrl.value = data.daemonUrl;
  setLight("daemon", true);
  applyRunner(data.dx);
  const settings = await send({ type: "get_settings" });
  const current = {
    ...DEFAULT_SETTINGS,
    ...((settings.ok ? settings.data : {}) as ExtensionSettings),
    daemonUrl: data.daemonUrl,
  };
  token.value = current.token;
  setLight("token", Boolean(current.token));
  await send({ type: "save_settings", settings: current });

  const fixtureId = data.dx?.projects?.fixture_project_id;
  await refreshProjects(fixtureId ?? current.projectId);

  summaryLine.textContent = `Daemon v${data.health.version ?? "?"} · ${
    data.dx?.runner?.mode ?? "?"
  } · 项目 ${data.dx?.projects?.count ?? "?"} 个`;
  setStatus(
    data.dx?.auth?.dx_bootstrap_enabled
      ? "已探测到 Daemon（DX bootstrap 已开启）。"
      : "已探测到 Daemon。无 token 时可从 .env 复制，或开启 SIGHTLOOP_DX_BOOTSTRAP=1。",
  );
}

async function prepareDemo(): Promise<void> {
  setStatus("准备 Demo：探测 → ensure fixture…");
  await discover();
  const boot = await send({ type: "dx_bootstrap" });
  if (boot.ok) {
    const t = (boot.data as { token?: string | null }).token;
    if (t) token.value = t;
    setLight("token", true);
  }
  // Persist current form before ensure (needs token).
  await send({ type: "save_settings", settings: readForm() });
  const ensured = await send({ type: "dx_ensure_fixture" });
  if (!ensured.ok) {
    setLight("project", false);
    setStatus(
      `Ensure fixture 失败：${ensured.error}\n下一步：确认 token，或检查 SIGHTLOOP_ALLOWED_ROOTS。`,
    );
    return;
  }
  const body = ensured.data as {
    project_id: string;
    fixture_hint?: string;
    created?: boolean;
  };
  await refreshProjects(body.project_id);
  setLight("project", true);
  setStatus(
    `Demo 已就绪（project ${body.project_id.slice(0, 8)}…${
      body.created ? " 新建" : " 已有"
    }）。\n请运行 pnpm dev:fixture → 打开 http://localhost:5175 → 热键拾取。\n${
      body.fixture_hint ?? ""
    }`,
  );
  summaryLine.textContent = "Demo 预填完成 — 启动 fixture 即可拾取";
}

async function load(): Promise<void> {
  const res = await send({ type: "get_settings" });
  if (!res.ok) {
    setStatus(res.error);
    return;
  }
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(res.data as ExtensionSettings),
  };
  daemonUrl.value = settings.daemonUrl;
  token.value = settings.token;
  await discover();
}

document.getElementById("discover")!.addEventListener("click", () => {
  void discover();
});

document.getElementById("prepareDemo")!.addEventListener("click", () => {
  void prepareDemo();
});

document.getElementById("save")!.addEventListener("click", async () => {
  const res = await send({ type: "save_settings", settings: readForm() });
  setStatus(res.ok ? "已保存。" : res.error);
  setLight("token", Boolean(readForm().token));
});

document.getElementById("refresh")!.addEventListener("click", () => {
  void refreshProjects();
});

document.getElementById("bootstrap")!.addEventListener("click", async () => {
  const res = await send({ type: "dx_bootstrap" });
  if (!res.ok) {
    setStatus(
      `${res.error}\n提示：在 .env 设置 SIGHTLOOP_DX_BOOTSTRAP=1 后重启 Daemon。`,
    );
    return;
  }
  const t = (res.data as { token?: string | null }).token;
  if (t) {
    token.value = t;
    setLight("token", true);
  }
  setStatus("Bootstrap 成功（仅 loopback + DX 开关开启时可用）。");
});

document.getElementById("bindRepo")!.addEventListener("click", async () => {
  const path = repoPath.value.trim();
  if (!path) {
    setStatus("请填写绝对 repo_path。");
    return;
  }
  await send({ type: "save_settings", settings: readForm() });
  const res = await send({ type: "dx_bind_repo", repo_path: path });
  if (!res.ok) {
    setStatus(`绑定失败：${res.error}\n检查路径是否存在且在 SIGHTLOOP_ALLOWED_ROOTS 内。`);
    setLight("project", false);
    return;
  }
  const project = (res.data as { project?: { id: string; name: string } })
    .project;
  await refreshProjects(project?.id);
  setStatus(
    `已绑定 ${project?.name ?? "project"}。请把 origin_pattern 配成与页面 URL 匹配。`,
  );
});

document.getElementById("pick")!.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) {
    setStatus("没有活动标签页。");
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle_pick" });
    setStatus("已切换该页拾取模式。");
    window.close();
  } catch {
    setStatus("此标签页无 content script（请打开 localhost 页面）。");
  }
});

void load();
