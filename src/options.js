const originInput = document.querySelector("#origin");
const tokenInput = document.querySelector("#token");
const status = document.querySelector("#status");
const shortcutEl = document.querySelector("#shortcut");
const copyShortcutBtn = document.querySelector("#copy-shortcut-url");
const saveBtn = document.querySelector("#save");
const clearBtn = document.querySelector("#clear");
const screenshotBox = document.querySelector("#screenshot-enabled");

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "toggle-annotation");
    shortcutEl.textContent = cmd?.shortcut || "Alt+Shift+P";
  } catch {
    shortcutEl.textContent = "Alt+Shift+P";
  }
}

copyShortcutBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("chrome://extensions/shortcuts");
    showStatus("快捷键设置地址已复制，请粘贴到浏览器地址栏打开");
  } catch {
    showStatus("复制失败，请手动输入 chrome://extensions/shortcuts", true);
  }
});

async function load() {
  try {
    const { loops = [] } = await chrome.storage.local.get("loops");
    const first = loops[0];
    if (first) {
      originInput.value = first.origin || "";
      tokenInput.value = first.token || "";
    }
    const { settings = {} } = await chrome.storage.local.get("settings");
    screenshotBox.checked = Boolean(settings.screenshot);
  } catch {}
}

screenshotBox.addEventListener("change", async () => {
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, screenshot: screenshotBox.checked } });
    showStatus(screenshotBox.checked ? "已开启自动截图" : "已关闭自动截图");
  } catch (e) {
    showStatus("保存失败：" + (e?.message || e), true);
  }
});

function showStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

saveBtn.addEventListener("click", async () => {
  const origin = originInput.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();
  if (!origin || !token) {
    showStatus("请填写服务地址和令牌", true);
    return;
  }
  try {
    const { loops = [] } = await chrome.storage.local.get("loops");
    const list = Array.isArray(loops) ? loops.filter((item) => item?.origin !== origin) : [];
    list.unshift({ origin, token, manual: true, updatedAt: Date.now() });
    await chrome.storage.local.set({ loops: list.slice(0, 12) });
    showStatus("已保存");
  } catch (e) {
    showStatus("保存失败：" + (e?.message || e), true);
  }
});

clearBtn.addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove("loops");
    originInput.value = "";
    tokenInput.value = "";
    showStatus("已清除");
  } catch (e) {
    showStatus("清除失败：" + (e?.message || e), true);
  }
});

void loadShortcut();
void load();
