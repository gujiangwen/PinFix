function markExtension() {
  const root = document.documentElement;
  if (!root) return false;
  if (root.dataset.sightloopExtension === "1") return true;
  root.dataset.sightloopExtension = "1";
  root.dispatchEvent(new Event("sightloop-extension"));
  return true;
}

if (!markExtension()) document.addEventListener("DOMContentLoaded", markExtension, { once: true });

function parseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function hostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

async function rememberLoop(entry) {
  const origin = String(entry?.origin || "").replace(/\/$/, "");
  const token = String(entry?.token || "");
  if (!origin || !token) return;
  try {
    const { loops = [] } = await chrome.storage.local.get("loops");
    const list = Array.isArray(loops) ? loops.filter((item) => item?.origin && item.origin !== origin) : [];
    list.unshift({ origin, token, updatedAt: Date.now() });
    await chrome.storage.local.set({ loops: list.slice(0, 12) });
  } catch {}
}

async function applySettings() {
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    document.documentElement.dataset.pinfixSettings = JSON.stringify({ screenshot: Boolean(settings.screenshot) });
  } catch {}
}
void applySettings();

document.documentElement.addEventListener("pinfix-capture-request", () => {
  const id = document.documentElement.dataset.pinfixCaptureRequest || "";
  chrome.runtime.sendMessage({ type: "capture-screenshot" }, (resp) => {
    const root = document.documentElement;
    root.dataset.pinfixCapture = !chrome.runtime.lastError && resp?.dataUrl ? resp.dataUrl : "";
    root.dataset.pinfixCaptureId = id;
    root.dispatchEvent(new Event("pinfix-capture-done"));
  });
});

document.documentElement.addEventListener("sightloop-console", () => {
  const info = parseJson(document.documentElement.dataset.sightloopConsole);
  if (info?.origin && info?.token) void rememberLoop(info);
});

async function applyConfig() {
  const root = document.documentElement;
  if (root?.dataset.sightloopConsole) return;
  const existing = parseJson(root?.dataset.sightloop);
  if (existing?.origin && existing?.token) {
    void rememberLoop(existing);
    return;
  }
  let matched = { origin: "", token: "" };
  try {
    const { loops = [] } = await chrome.storage.local.get("loops");
    const list = Array.isArray(loops) ? loops : [];
    const isConsole = list.some((item) => item?.origin === location.origin);
    if (isConsole) return;
    // 手动配置的连接（options 页保存）对所有页面生效
    const manual = list.find((item) => item?.manual);
    if (manual) {
      matched = { origin: manual.origin, token: manual.token };
    } else if (document.querySelector("[data-sl-file]")) {
      // ponytail: 自动发现的连接仅对同主机名且带源码标记的页面自动配对
      const hit = list.find((item) => hostname(item?.origin) === location.hostname);
      if (hit) matched = { origin: hit.origin, token: hit.token };
    }
  } catch {}
  root.dataset.sightloop = JSON.stringify(matched);
  root.dispatchEvent(new Event("sightloop-ready"));
}

async function settleConsole() {
  const root = document.documentElement;
  if (!root || root.dataset.sightloopConsole) return;
  try {
    const { loops = [] } = await chrome.storage.local.get("loops");
    if (!Array.isArray(loops) || !loops.some((item) => item?.origin === location.origin)) return;
  } catch {}
  root.dataset.sightloop = JSON.stringify({ origin: "", token: "" });
  root.dispatchEvent(new Event("sightloop-ready"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void applyConfig(), { once: true });
} else {
  void applyConfig();
}
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void settleConsole(); }, { once: true });
  } else {
    void settleConsole();
  }

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.loops) void applyConfig();
  if (changes.settings) void applySettings();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "annotate-state") {
    const root = document.documentElement;
    const cfg = parseJson(root?.dataset.sightloop);
    sendResponse({
      active: Boolean(root?.dataset.sightloop) && !root?.dataset.sightloopConsole,
      picking: root?.dataset.sightloopPicking === "1",
      origin: cfg?.origin || "",
      token: cfg?.token || "",
    });
    return;
  }
  if (message?.type !== "annotate") return;
  document.documentElement.dataset.sightloopCommand = "toggle-pick";
  document.documentElement.dispatchEvent(new Event("sightloop-command"));
  sendResponse({ picking: document.documentElement.dataset.sightloopPicking === "1" });
});
