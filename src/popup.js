const annotate = document.querySelector("#annotate");
const annotateLabel = document.querySelector("#annotate-label");
const annotateShot = document.querySelector("#annotate-shot");
const annotateShotLabel = document.querySelector("#annotate-shot-label");
const status = document.querySelector("#status");
const statusText = document.querySelector("#status-text");
const settingsBtn = document.querySelector("#settings");
const shortcutDisplay = document.querySelector("#shortcut-display");
const shortcutFix = document.querySelector("#shortcut-fix");
const updateBtn = document.querySelector("#update");
const updateVersion = document.querySelector("#update-version");

const CURRENT_VERSION = chrome.runtime.getManifest().version;
const RELEASE_API = "https://api.github.com/repos/gujiangwen/PinFix/releases/latest";

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function checkUpdate() {
  try {
    const { updateCheckedAt = "" } = await chrome.storage.local.get("updateCheckedAt");
    const today = new Date().toISOString().slice(0, 10);
    if (updateCheckedAt === today) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(RELEASE_API, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } });
    clearTimeout(timer);
    if (!res.ok) return;
    await chrome.storage.local.set({ updateCheckedAt: today });
    const data = await res.json();
    const latest = String(data.tag_name || "").replace(/^v/, "");
    if (latest && compareVersions(latest, CURRENT_VERSION) > 0) {
      updateVersion.textContent = `v${latest}`;
      updateBtn.dataset.url = data.html_url || "https://github.com/gujiangwen/PinFix/releases";
      updateBtn.dataset.show = "true";
    }
  } catch {}
}

updateBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: updateBtn.dataset.url || "https://github.com/gujiangwen/PinFix/releases" });
  window.close();
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

async function showShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "toggle-annotation");
    shortcutDisplay.textContent = cmd?.shortcut || "未设置";
  } catch {
    shortcutDisplay.textContent = "Alt+Shift+P";
  }
}
void showShortcut();

shortcutFix.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("chrome://extensions/shortcuts");
    shortcutFix.textContent = "已复制地址，粘贴到地址栏打开";
  } catch {
    shortcutFix.textContent = "请手动输入 chrome://extensions/shortcuts";
  }
});

if (!("focusGroup" in HTMLElement.prototype)) {
  document.querySelectorAll('[focusgroup~="menu"]').forEach((group) => {
    group.setAttribute("role", "menu");
    group.querySelectorAll("button:not([role])").forEach((item) => {
      item.setAttribute("role", "menuitem");
    });
    group.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = [...group.querySelectorAll("button")]
        .filter((item) => item.closest("[focusgroup]") === group)
        .filter((item) => item.getAttribute("aria-disabled") !== "true");
      const current = items.indexOf(document.activeElement);
      if (current < 0) return;
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      event.preventDefault();
      event.stopImmediatePropagation();
      items[next].focus({ preventScroll: true });
    }, true);
  });
}

function loopHost(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

async function checkConsole(origin, token) {
  if (!origin || !token) return false;
  try {
    const response = await fetch(`${origin}/api/meta`, { headers: { Authorization: `Bearer ${token}` } });
    return response.ok;
  } catch {
    return false;
  }
}

async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const page = tab?.url || "";
  if (!tab?.id || !page.startsWith("http")) {
    annotate.setAttribute("aria-disabled", "true");
    annotateShot.setAttribute("aria-disabled", "true");
    statusText.textContent = "请在目标网页中使用";
    return;
  }
  let state;
  try {
    state = await chrome.tabs.sendMessage(tab.id, { type: "annotate-state" });
    if (!state?.active) throw new Error("inactive");
  } catch {
    // 内容脚本未注入（多为安装/更新后未刷新页面）：刷新后自动注入并直接进入标注态
    statusText.textContent = "正在刷新页面，稍后自动开始标注…";
    await chrome.storage.session.set({ [`pickAfterLoad:${tab.id}`]: true });
    await chrome.tabs.reload(tab.id);
    setTimeout(() => window.close(), 400);
    return;
  }
  annotate.removeAttribute("aria-disabled");
  annotateShot.removeAttribute("aria-disabled");
  annotate.toggleAttribute("data-picking", Boolean(state.picking));
  annotateShot.toggleAttribute("data-picking", Boolean(state.picking));
  annotateLabel.textContent = state.picking ? "取消标注" : "简单标注";
  annotateShotLabel.textContent = state.picking ? "取消标注" : "截图标注";
  const origin = String(state.origin || "").replace(/\/$/, "");
  const token = String(state.token || "");
  const connected = await checkConsole(origin, token);
  status.dataset.mode = connected ? "live" : "copy";
  statusText.textContent = connected
    ? `已接入 · ${loopHost(origin)}`
    : "提示词模式 · 标注后复制";
}

void initPopup();
void checkUpdate();

async function startAnnotate(event, button, withScreenshot) {
  if (button.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "annotate", screenshot: withScreenshot });
  window.close();
}

annotate.addEventListener("click", (event) => startAnnotate(event, annotate, false));
annotateShot.addEventListener("click", (event) => startAnnotate(event, annotateShot, true));
