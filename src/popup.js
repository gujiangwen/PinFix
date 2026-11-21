const annotate = document.querySelector("#annotate");
const annotateLabel = document.querySelector("#annotate-label");
const status = document.querySelector("#status");

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
    status.textContent = "请在目标网页中使用";
    return;
  }
  let state;
  try {
    state = await chrome.tabs.sendMessage(tab.id, { type: "annotate-state" });
    if (!state?.active) throw new Error("inactive");
  } catch {
    annotate.setAttribute("aria-disabled", "true");
    status.textContent = "请刷新目标页面后标注";
    return;
  }
  annotate.removeAttribute("aria-disabled");
  annotate.toggleAttribute("data-picking", Boolean(state.picking));
  annotateLabel.textContent = state.picking ? "取消标注" : "开始标注";
  const origin = String(state.origin || "").replace(/\/$/, "");
  const token = String(state.token || "");
  const connected = await checkConsole(origin, token);
  status.dataset.mode = connected ? "live" : "copy";
  status.textContent = connected
    ? `已接入 · ${loopHost(origin)}`
    : "提示词模式 · 标注后复制";
}

void initPopup();

annotate.addEventListener("click", async (event) => {
  if (annotate.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "annotate" });
  window.close();
});
