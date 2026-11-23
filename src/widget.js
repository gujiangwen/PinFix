function bootSightloop(cfg) {
let origin = String(cfg.origin || "").replace(/\/$/, "");
let token = String(cfg.token || "");

const STATUS = {
  pending: "待处理",
  analyzing: "分析中",
  awaiting_plan_approval: "待批",
  ready_to_fix: "待修复",
  fixing: "修复中",
  reviewing: "审核中",
  awaiting_confirm: "待确认",
  needs_human: "需人工",
  reverted: "已回撤",
};

const VISIBLE = new Set(Object.keys(STATUS));

const host = document.createElement("div");
host.id = "pinfix-host";
document.documentElement.appendChild(host);
const shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML = `
<style>
  :host {
    all: initial;
    color-scheme: light dark;
    --bg: #ffffff;
    --surface: #f4f6f8;
    --ink: #1c2430;
    --muted: #5c6b7a;
    --line: #e2e7ee;
    --accent: #1f6f5b;
    --accent-ink: #ffffff;
    --warn: #8a4b1f;
    --danger: #8d2f2f;
    --shadow: 0 12px 32px rgba(16, 20, 27, 0.14), 0 2px 6px rgba(16, 20, 27, 0.06);
    @media (prefers-color-scheme: dark) {
      --bg: #171d27;
      --surface: #10141b;
      --ink: #e7eef8;
      --muted: #9aabbf;
      --line: #2c3a4c;
      --accent: #3dbea2;
      --accent-ink: #06241c;
      --warn: #e0b070;
      --danger: #f0a0a0;
      --shadow: 0 16px 36px rgba(0, 0, 0, 0.42), 0 2px 8px rgba(0, 0, 0, 0.24);
    }
    @supports (color: light-dark(white, black)) {
      --bg: light-dark(#ffffff, #171d27);
      --surface: light-dark(#f4f6f8, #10141b);
      --ink: light-dark(#1c2430, #e7eef8);
      --muted: light-dark(#5c6b7a, #9aabbf);
      --line: light-dark(#e2e7ee, #2c3a4c);
      --accent: light-dark(#1f6f5b, #3dbea2);
      --accent-ink: light-dark(#ffffff, #06241c);
      --warn: light-dark(#8a4b1f, #e0b070);
      --danger: light-dark(#8d2f2f, #f0a0a0);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, textarea { font: 13px/1.45 system-ui, sans-serif; color: inherit; }
  button {
    border: 1px solid var(--accent); border-radius: 999px; padding: 5px 12px;
    background: var(--accent); color: var(--accent-ink); font-weight: 500; cursor: pointer;
    transition: filter 0.12s, background-color 0.12s;
  }
  button:hover { filter: brightness(1.06); }
  button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button.ghost { background: transparent; border-color: var(--line); color: var(--muted); }
  button.ghost:hover { color: var(--ink); border-color: var(--muted); filter: none; }
  button.warn { background: transparent; border-color: var(--warn); color: var(--warn); }
  button.danger { background: transparent; border-color: var(--danger); color: var(--danger); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
  .mask, .hover, .rubber { position: fixed; border-radius: 6px; }
  .hover { border: 1px dashed #7dceb8; background: rgba(31, 138, 112, 0.08); }
  .rubber { border: 1px solid #1f8a70; background: rgba(31, 138, 112, 0.16); }
  .mask { background: rgba(36, 86, 168, 0.14); border: 1.5px solid #2456a8; }
  .mask.analyzing, .mask.fixing, .mask.reviewing, .mask.ready_to_fix { background: rgba(36, 86, 168, 0.16); border-color: #2456a8; }
  .mask.awaiting_confirm { background: rgba(31, 138, 112, 0.16); border-color: #1f8a70; }
  .mask.awaiting_plan_approval, .mask.needs_human { background: rgba(138, 75, 31, 0.18); border-color: #c47a3a; }
  .mask.reverted, .mask.pending { background: rgba(90, 102, 120, 0.16); border-color: #8b9bb0; }
  .marker, .missing {
    position: fixed; z-index: 2147483001; pointer-events: auto;
    display: inline-flex; align-items: center; gap: 6px;
    border: 0; border-radius: 999px; padding: 3px 9px; color: white; font-size: 12px; cursor: pointer;
    background: #2456a8; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }
  .marker.awaiting_confirm { background: #1f8a70; }
  .marker.awaiting_plan_approval, .marker.needs_human { background: #8a4b1f; }
  .marker.reverted, .marker.pending { background: #4d5b6e; }
  .marker i, .missing i { width: 6px; height: 6px; border-radius: 99px; background: white; display: inline-block; }
  .card, .draft {
    position: fixed; z-index: 2147483003; width: min(320px, calc(100vw - 24px));
    background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 14px; padding: 12px;
    box-shadow: var(--shadow); font: 13px/1.45 system-ui, sans-serif;
  }
  .card[hidden], .draft[hidden], .hover[hidden], .rubber[hidden] { display: none; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .head strong { font-size: 13px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  textarea {
    display: block; width: 100%; height: auto; field-sizing: content; min-block-size: 2.8lh; max-block-size: 8lh;
    resize: none; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: inherit; padding: 8px 10px;
  }
  .card textarea { margin-top: 8px; min-block-size: 2.2lh; }
  .meta {
    color: var(--muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 8px;
  }
  .card .meta { margin: 0; flex: none; font-family: inherit; }
  .meta:empty { display: none; }
  .row { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .log { max-height: 170px; overflow: auto; margin-top: 6px; font-size: 12.5px; }
  .log div { padding: 5px 0; border-top: 1px solid var(--line); color: var(--ink); }
  .log div:first-child { border-top: 0; padding-top: 2px; }
  .box { position: fixed; pointer-events: none; z-index: 2147483000; }
  .box.margin { background: rgba(246, 178, 107, 0.45); }
  .box.border { background: rgba(255, 229, 153, 0.6); }
  .box.padding { background: rgba(147, 196, 125, 0.45); }
  .box.content { background: rgba(111, 168, 220, 0.45); }
  .tip {
    position: fixed; z-index: 2147483002; pointer-events: none;
    max-width: min(460px, calc(100vw - 16px));
    background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 3px 8px;
    box-shadow: var(--shadow); font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .crumbs {
    position: fixed; z-index: 2147483004; left: 50%; bottom: 16px; transform: translateX(-50%);
    max-width: calc(100vw - 24px); display: flex; align-items: center; gap: 2px; overflow-x: auto;
    background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px;
    box-shadow: var(--shadow); font: 12px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
    scrollbar-width: none; user-select: none;
  }
  .crumbs::-webkit-scrollbar { display: none; }
  .crumbs[hidden], .tip[hidden], .box[hidden] { display: none; }
  .crumbs .hint, .crumbs .sep { color: var(--muted); flex: none; }
  .crumbs button {
    border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-weight: 400;
    padding: 3px 7px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .crumbs button:hover { color: var(--ink); filter: none; }
  .crumbs button.has-source { color: var(--ink); }
  .crumbs button.current { background: var(--accent); color: var(--accent-ink); font-weight: 500; }
</style>
<div class="layer" id="layer">
  <div class="hover" id="hover" hidden></div>
  <div class="rubber" id="rubber" hidden></div>
</div>
<section class="draft" id="draft" hidden aria-label="新建标注">
  <div class="meta" id="draft-meta" role="status"></div>
  <label class="vh" for="draft-text">问题描述</label>
  <textarea id="draft-text" placeholder="描述问题（Enter 提交，Shift+Enter 换行）"></textarea>
  <div class="row">
    <button type="button" class="ghost" id="draft-cancel">取消</button>
    <button type="button" id="draft-submit">提交</button>
  </div>
</section>
<section class="card" id="card" hidden aria-label="标注详情">
  <div class="head">
    <strong id="card-title">标注</strong>
    <span class="meta" id="card-meta"></span>
  </div>
  <div class="log" id="card-log"></div>
  <label class="vh" for="note">追加描述</label>
  <textarea id="note" placeholder="补充说明（Enter 发送）"></textarea>
  <div class="row" id="card-actions"></div>
</section>
<div class="box margin" id="box-margin" hidden></div>
<div class="box border" id="box-border" hidden></div>
<div class="box padding" id="box-padding" hidden></div>
<div class="box content" id="box-content" hidden></div>
<div class="tip" id="tip" hidden></div>
<nav class="crumbs" id="crumbs" hidden aria-label="元素层次"></nav>
`;

const $ = (id) => shadow.getElementById(id);
const state = {
  picking: false,
  issues: [],
  openId: null,
  draft: null,
  draftRect: null,
  gesture: null,
  suppressClick: false,
  hoverEl: null,
  crumbRoot: null,
  downStack: [],
};
const cursorStyle = document.createElement("style");
cursorStyle.textContent = "html.sightloop-picking, html.sightloop-picking * { cursor: crosshair !important; }";
document.head.appendChild(cursorStyle);

function setPicking(on) {
  state.picking = on;
  document.documentElement.dataset.sightloopPicking = on ? "1" : "0";
  document.documentElement.classList.toggle("sightloop-picking", on);
  if (!on) clearHover();
}
document.documentElement.addEventListener("sightloop-command", () => {
  if (document.documentElement.dataset.sightloopCommand !== "toggle-pick") return;
  setPicking(!state.picking);
  $("rubber").hidden = true;
});
const diagnostics = [];

window.addEventListener("error", (event) => {
  diagnostics.push(String(event.message || "error").slice(0, 300));
  if (diagnostics.length > 20) diagnostics.shift();
});

function api(pathname, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) };
  return fetch(`${origin}${pathname}`, { ...options, headers }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || response.statusText);
    return body;
  });
}

function sourceElement(node) {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element || host.contains(element)) return null;
  return element.closest?.("[data-sl-file]") || element;
}

function projectPrefix() {
  if (location.port === "5174") return "mobile";
  if (location.port === "5173") return "frontend";
  return "";
}

function normalizeVueFile(file) {
  const norm = String(file || "").replace(/\\/g, "/");
  const known = norm.match(/(?:^|\/)((?:frontend|mobile)\/.*\.(?:vue|tsx|jsx))$/);
  if (known) return known[1];
  const src = norm.match(/\/src\/.+\.(?:vue|tsx|jsx)$/);
  if (!src) return norm;
  const prefix = projectPrefix();
  return prefix ? `${prefix}${src[0]}` : src[0].slice(1);
}

function componentFile(element) {
  let node = element;
  while (node && node.nodeType === 1) {
    const file = node.__vueParentComponent?.type?.__file;
    if (typeof file === "string" && file) return normalizeVueFile(file);
    node = node.parentElement;
  }
  return "";
}

function componentChain(element) {
  const chain = [];
  const seen = new Set();
  let node = element;
  while (node && node.nodeType === 1 && chain.length < 4) {
    const file = node.__vueParentComponent?.type?.__file;
    if (typeof file === "string" && file) {
      const name = normalizeVueFile(file).split("/").pop() || file;
      if (!seen.has(name)) {
        seen.add(name);
        chain.unshift(name);
      }
    }
    node = node.parentElement;
  }
  return chain;
}

function layoutSnapshot(element) {
  if (!element) return "";
  const cs = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const parts = [`视口 ${window.innerWidth}×${window.innerHeight}`];
  parts.push(`元素 ${Math.round(rect.width)}×${Math.round(rect.height)}`);
  const layoutBits = [];
  if (cs.display && cs.display !== "block") layoutBits.push(`display:${cs.display}`);
  if (cs.position && cs.position !== "static") layoutBits.push(`position:${cs.position}`);
  if (cs.overflow !== "visible") layoutBits.push(`overflow:${cs.overflow}`);
  if (cs.height !== "auto") layoutBits.push(`height:${cs.height}`);
  if (layoutBits.length) parts.push(layoutBits.join(" "));
  const parent = element.parentElement;
  if (parent) {
    const pr = parent.getBoundingClientRect();
    parts.push(`父容器 ${Math.round(pr.width)}×${Math.round(pr.height)}`);
  }
  return parts.join(" | ");
}

function anchorFrom(element, rect, kind, text) {
  const bounds = element?.getBoundingClientRect?.() || rect;
  const width = bounds.width || 1;
  const height = bounds.height || 1;
  const chain = element ? componentChain(element) : [];
  return {
    kind,
    file: element?.getAttribute?.("data-sl-file") || componentFile(element) || "",
    line: Number(element?.getAttribute?.("data-sl-line") || 0),
    label: element ? nodeName(element) : "",
    path: element ? pathWithin(document.body, element) : "",
    selector: element?.tagName?.toLowerCase() || "",
    text: (text || element?.textContent || "").trim().slice(0, 80),
    chain: chain.length ? chain : undefined,
    layout: element ? layoutSnapshot(element) : "",
    box: {
      x: (rect.left - bounds.left) / width,
      y: (rect.top - bounds.top) / height,
      w: rect.width / width,
      h: rect.height / height,
    },
  };
}

function locate(anchor) {
  const element = resolveAnchor(anchor);
  if (element) {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: Math.max(12, bounds.width), height: Math.max(12, bounds.height) };
  }
  if (!anchor?.file) return null;
  const source = sourceAt(anchor);
  if (!source) return null;
  const bounds = source.getBoundingClientRect();
  const box = anchor.box || { x: 0, y: 0, w: 1, h: 1 };
  return {
    left: bounds.left + box.x * bounds.width,
    top: bounds.top + box.y * bounds.height,
    width: Math.max(12, box.w * bounds.width),
    height: Math.max(12, box.h * bounds.height),
  };
}

function sourceAt(anchor) {
  if (!anchor?.file) return null;
  let matches = [];
  try {
    const selector = `[data-sl-file="${CSS.escape(anchor.file)}"][data-sl-line="${CSS.escape(String(anchor.line || ""))}"]`;
    matches = [...document.querySelectorAll(selector)];
  } catch {
    return null;
  }
  return matches[anchor.index || 0] || matches[0] || null;
}

function resolveAnchor(anchor) {
  if (!anchor) return null;
  if (!anchor.file && anchor.path) {
    try {
      return document.body.querySelector(anchor.path);
    } catch {
      return null;
    }
  }
  const source = sourceAt(anchor);
  if (!source) return null;
  if (!anchor.path) return anchor.kind === "element" ? source : null;
  try {
    return source.querySelector(anchor.path);
  } catch {
    return null;
  }
}

function px(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function elementAt(x, y) {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof Element) || node === host || host.contains(node)) continue;
    return node;
  }
  return null;
}

function nodeName(element) {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join("");
  return `${tag}${id}${classes}`;
}

function sourceLabel(element) {
  const marked = element?.getAttribute?.("data-sl-file");
  if (marked) return `${marked.split("/").pop()}:${element.getAttribute("data-sl-line") || "?"}`;
  const file = componentFile(element);
  return file ? file.split("/").pop() : "";
}

function pathWithin(root, target) {
  if (!root || root === target) return "";
  const parts = [];
  let node = target;
  while (node && node !== root) {
    const parent = node.parentElement;
    if (!parent) return "";
    const same = [...parent.children].filter((item) => item.tagName === node.tagName);
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})`);
    node = parent;
  }
  return node === root ? `:scope > ${parts.join(" > ")}` : "";
}

function selectionAnchor(element) {
  const source = element.closest?.("[data-sl-file]") || null;
  const rect = element.getBoundingClientRect();
  const anchor = anchorFrom(source || element, rect, "element", (element.innerText || element.textContent || "").trim().slice(0, 80));
  anchor.label = nodeName(element);
  anchor.path = source ? pathWithin(source, element) : pathWithin(document.body, element);
  if (source) {
    const file = source.getAttribute("data-sl-file");
    const line = source.getAttribute("data-sl-line") || "";
    const matches = [...document.querySelectorAll(`[data-sl-file="${CSS.escape(file)}"][data-sl-line="${CSS.escape(line)}"]`)];
    anchor.index = Math.max(0, matches.indexOf(source));
  } else {
    anchor.file = componentFile(element);
    anchor.line = 0;
    anchor.index = 0;
  }
  return anchor;
}

function clearHover() {
  state.hoverEl = null;
  state.crumbRoot = null;
  state.downStack = [];
  for (const id of ["box-margin", "box-border", "box-padding", "box-content", "tip", "hover"]) $(id).hidden = true;
  $("crumbs").hidden = true;
  $("crumbs").replaceChildren();
}

function hideBoxes() {
  for (const id of ["box-margin", "box-border", "box-padding", "box-content", "tip", "hover"]) $(id).hidden = true;
}

function placeBox(id, rect) {
  const node = $(id);
  if (!rect || rect.width < 0 || rect.height < 0) {
    node.hidden = true;
    return;
  }
  placeRect(node, rect);
}

function showHover(element, options = {}) {
  if (!element?.isConnected) return;
  state.hoverEl = element;
  const style = getComputedStyle(element);
  const border = element.getBoundingClientRect();
  const margin = {
    left: border.left - px(style.marginLeft),
    top: border.top - px(style.marginTop),
    width: Math.max(0, border.width + px(style.marginLeft) + px(style.marginRight)),
    height: Math.max(0, border.height + px(style.marginTop) + px(style.marginBottom)),
  };
  const padding = {
    left: border.left + px(style.borderLeftWidth),
    top: border.top + px(style.borderTopWidth),
    width: Math.max(0, border.width - px(style.borderLeftWidth) - px(style.borderRightWidth)),
    height: Math.max(0, border.height - px(style.borderTopWidth) - px(style.borderBottomWidth)),
  };
  const content = {
    left: padding.left + px(style.paddingLeft),
    top: padding.top + px(style.paddingTop),
    width: Math.max(0, padding.width - px(style.paddingLeft) - px(style.paddingRight)),
    height: Math.max(0, padding.height - px(style.paddingTop) - px(style.paddingBottom)),
  };
  placeBox("box-margin", margin);
  placeBox("box-border", border);
  placeBox("box-padding", padding);
  placeBox("box-content", content);
  const own = sourceLabel(element);
  const inherited = own || sourceLabel(element.closest?.("[data-sl-file]"));
  const where = own ? own : inherited ? `源码 ${inherited}` : "无源码位置";
  const tip = $("tip");
  tip.hidden = false;
  tip.textContent = `${nodeName(element)}  ${Math.round(border.width)} × ${Math.round(border.height)}  ${where}`;
  const tipTop = margin.top > 28 ? margin.top - 22 : border.bottom + 4;
  tip.style.left = `${Math.max(8, Math.min(margin.left, window.innerWidth - 320))}px`;
  tip.style.top = `${Math.max(8, tipTop)}px`;
  if (options.keepCrumbs) markCrumb(element);
  else if (state.crumbRoot !== element) renderCrumbs(element);
}

function ancestors(element) {
  const chain = [];
  let node = element;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    if (node !== host && !host.contains(node)) chain.push(node);
    node = node.parentElement;
  }
  return chain.reverse();
}

function renderCrumbs(element) {
  state.crumbRoot = element;
  const chain = ancestors(element);
  const nav = $("crumbs");
  nav.hidden = false;
  nav.replaceChildren();
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "层次";
  nav.appendChild(hint);
  for (const node of chain) {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "›";
    nav.appendChild(sep);
    const button = document.createElement("button");
    button.type = "button";
    button._node = node;
    button.textContent = nodeName(node);
    const source = sourceLabel(node);
    if (source) {
      button.classList.add("has-source");
      button.title = source;
    }
    button.addEventListener("pointerenter", () => showHover(node, { keepCrumbs: true }));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectElement(node);
    });
    nav.appendChild(button);
  }
  markCrumb(element);
}

function markCrumb(element) {
  for (const button of $("crumbs").querySelectorAll("button")) {
    button.classList.toggle("current", button._node === element);
  }
}

function moveHover(direction) {
  const current = state.hoverEl;
  if (!current?.isConnected) return;
  if (direction < 0) {
    const parent = current.parentElement;
    if (!parent || parent === document.documentElement || parent === document.body.parentElement) return;
    if (parent === host || host.contains(parent)) return;
    state.downStack.push(current);
    showHover(parent);
    return;
  }
  const remembered = state.downStack.at(-1);
  if (remembered?.isConnected && remembered.parentElement === current) {
    state.downStack.pop();
    showHover(remembered);
    return;
  }
  const child = [...current.children].find((node) => node !== host && !host.contains(node));
  if (child) showHover(child);
}

function selectElement(element) {
  if (!element?.isConnected) return;
  const rect = element.getBoundingClientRect();
  showDraft(selectionAnchor(element), { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
}

function placeRect(node, rect) {
  node.hidden = false;
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

function renderMarks() {
  const layer = $("layer");
  for (const node of layer.querySelectorAll(".mask, .marker, .missing")) node.remove();
  let missing = 0;
  for (const issue of state.issues) {
    if (!VISIBLE.has(issue.status) || issue.source === "log") continue;
    const rect = locate(issue.anchor);
    if (!rect) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `missing ${issue.status}`;
      chip.dataset.issueId = issue.id;
      chip.style.top = `${16 + missing * 36}px`;
      chip.style.right = "16px";
      chip.innerHTML = `<i></i>位置已变化 · ${STATUS[issue.status] || issue.status}`;
      chip.addEventListener("click", () => openCard(issue.id));
      layer.appendChild(chip);
      missing += 1;
      continue;
    }
    const mask = document.createElement("div");
    mask.className = `mask ${issue.status}`;
    placeRect(mask, rect);
    layer.appendChild(mask);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `marker ${issue.status}`;
    marker.dataset.issueId = issue.id;
    marker.style.left = `${rect.left + rect.width - 8}px`;
    marker.style.top = `${Math.max(8, rect.top - 14)}px`;
    marker.innerHTML = `<i></i>${STATUS[issue.status] || issue.status}`;
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      openCard(issue.id);
    });
    layer.appendChild(marker);
  }
  if (state.draft) {
    const rect = locate(state.draft) || state.draftRect;
    if (rect && rect.width) {
      const preview = document.createElement("div");
      preview.className = "mask pending";
      placeRect(preview, rect);
      layer.appendChild(preview);
    }
  }
  if (state.openId) positionCard();
}

function positionCard() {
  const card = $("card");
  const marker = shadow.querySelector(`[data-issue-id="${CSS.escape(state.openId || "")}"]`);
  const rect = marker?.getBoundingClientRect() || { right: 24, left: 24, bottom: 80 };
  const width = card.offsetWidth || 340;
  let left = rect.right + 8;
  if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 8);
  card.style.left = `${left}px`;
  card.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 280)}px`;
}

function openCard(id) {
  state.openId = id;
  const issue = state.issues.find((item) => item.id === id);
  const card = $("card");
  if (!issue) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("card-title").textContent = issue.title || "标注";
  $("card-meta").textContent = `${STATUS[issue.status] || issue.status}${issue.error ? ` · ${issue.error}` : ""}`;
  const log = $("card-log");
  log.replaceChildren();
  const lines = [issue.description];
  if (issue.plan?.summary) lines.push(`方案：${issue.plan.summary}`);
  if (issue.change?.summary) lines.push(`改动：${issue.change.summary}`);
  if (issue.review) lines.push(`审核：${issue.review.passed ? "通过" : "未通过"}${issue.review.feedback ? ` · ${issue.review.feedback}` : ""}`);
  if (issue.error) lines.push(`报错：${issue.error}`);
  for (const event of issue.events || []) lines.push(event.text);
  for (const text of lines.filter(Boolean)) {
    const row = document.createElement("div");
    row.textContent = text;
    log.appendChild(row);
  }
  const actions = $("card-actions");
  const typing = shadow.activeElement === $("note");
  if (!typing) actions.replaceChildren();
  if (!typing) {
    const add = (label, className, run) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className || "";
      button.textContent = label;
      button.addEventListener("click", run);
      actions.appendChild(button);
    };
    add("追加描述", "", () => act(issue, "feedback"));
    if (issue.patch_applied) add("回撤", "danger", () => act(issue, "revert"));
    if (issue.status === "awaiting_confirm") add("确认", "", () => act(issue, "confirm"));
    if (issue.status === "awaiting_plan_approval") add("批准方案", "", () => act(issue, "approve"));
    add("关闭问题", "ghost", () => act(issue, "close"));
    add("收起", "ghost", () => hideCard());
  }
  positionCard();
}

function hideCard() {
  state.openId = null;
  $("card").hidden = true;
}

async function act(issue, name) {
  try {
    if (name === "feedback") {
      const text = $("note").value.trim();
      if (!text) return;
      await api(`/api/issues/${issue.id}/feedback`, { method: "POST", body: JSON.stringify({ text }) });
      $("note").value = "";
    } else {
      await api(`/api/issues/${issue.id}/${name}`, { method: "POST", body: "{}" });
    }
    if (name === "close" || name === "confirm") hideCard();
    await refresh();
  } catch (error) {
    $("card-meta").textContent = error instanceof Error ? error.message : String(error);
  }
}

function showDraft(anchor, rect) {
  state.draft = anchor;
  state.draftRect = rect;
  setPicking(false);
  const draft = $("draft");
  draft.hidden = false;
  $("draft-meta").textContent = [
    anchor.label,
    anchor.file ? `${anchor.file}${anchor.line ? `:${anchor.line}` : ""}` : anchor.path,
  ].filter(Boolean).join(" · ");
  const connected = pageConnected();
  $("draft-submit").textContent = connected ? "提交" : "复制提示词";
  $("draft-text").placeholder = connected
    ? "问题描述（Enter 提交，Shift+Enter 换行）\n可选：第二行写期望，如「点击无响应，期望：弹出弹窗」"
    : "问题描述（Enter 复制提示词，Shift+Enter 换行）\n可选：第二行写期望，如「点击无响应，期望：弹出弹窗」";
  $("draft-text").value = "";
  const width = 320;
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  const below = rect.top + rect.height + 8;
  const top = below + 170 > window.innerHeight && rect.top > 180 ? rect.top - 168 : Math.min(below, window.innerHeight - 180);
  draft.style.left = `${Math.max(8, left)}px`;
  draft.style.top = `${Math.max(8, top)}px`;
  $("draft-text").focus();
  renderMarks();
}

function hideDraft() {
  state.draft = null;
  state.draftRect = null;
  $("draft").hidden = true;
  renderMarks();
}

function pageConnected() {
  return Boolean(origin && token);
}

function legacyCopy(text) {
  const field = Object.assign(document.createElement("textarea"), { value: text });
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
  document.body.append(field);
  field.select();
  try { return document.execCommand("copy"); } finally { field.remove(); }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (!legacyCopy(text)) throw new Error("复制失败，请检查剪贴板权限");
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function copyTextAndImage(text, imageDataUrl) {
  if (imageDataUrl && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = dataUrlToBlob(imageDataUrl);
      const item = new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "image/png": blob,
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {}
  }
  await copyText(text);
  return false;
}

async function refresh() {
  if (!pageConnected()) return;
  state.issues = await api("/api/issues").catch(() => []);
  renderMarks();
  if (state.openId) openCard(state.openId);
}

let lastNotice = "";
let screenshotSetting = false;

function readPinfixSettings() {
  try {
    const raw = document.documentElement?.dataset?.pinfixSettings;
    screenshotSetting = raw ? Boolean(JSON.parse(raw)?.screenshot) : false;
  } catch {
    screenshotSetting = false;
  }
}
readPinfixSettings();
new MutationObserver(() => readPinfixSettings()).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-pinfix-settings"],
});

function requestScreenshot() {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const root = document.documentElement;
    const onDone = () => {
      root.removeEventListener("pinfix-capture-done", onDone);
      if (root.dataset.pinfixCaptureId !== id) return;
      resolve(root.dataset.pinfixCapture || "");
      delete root.dataset.pinfixCapture;
      delete root.dataset.pinfixCaptureId;
      delete root.dataset.pinfixCaptureRequest;
    };
    root.addEventListener("pinfix-capture-done", onDone);
    root.dataset.pinfixCaptureRequest = id;
    root.dispatchEvent(new Event("pinfix-capture-request"));
    setTimeout(onDone, 4000);
  });
}

function drawScreenshot(dataUrl, rect) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = img.width / window.innerWidth || 1;
      // 以问题区域为中心裁剪上下文，各方向外扩约 2 倍，夹在可视区内
      const padX = Math.max(rect.width * 1.5, 80);
      const padY = Math.max(rect.height * 1.5, 60);
      const cropLeft = Math.max(0, rect.left - padX);
      const cropTop = Math.max(0, rect.top - padY);
      const cropRight = Math.min(window.innerWidth, rect.left + rect.width + padX);
      const cropBottom = Math.min(window.innerHeight, rect.top + rect.height + padY);
      const cropW = Math.max(1, cropRight - cropLeft);
      const cropH = Math.max(1, cropBottom - cropTop);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cropW * scale);
      canvas.height = Math.round(cropH * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        cropLeft * scale, cropTop * scale, cropW * scale, cropH * scale,
        0, 0, canvas.width, canvas.height
      );
      ctx.lineWidth = Math.max(2, 2 * scale);
      ctx.strokeStyle = "#e5484d";
      ctx.strokeRect(
        (rect.left - cropLeft) * scale,
        (rect.top - cropTop) * scale,
        rect.width * scale,
        rect.height * scale
      );
      ctx.fillStyle = "#e5484d";
      const fontSize = Math.max(12, 12 * scale);
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      ctx.textBaseline = "bottom";
      const labelX = (rect.left - cropLeft) * scale;
      const labelY = Math.max(fontSize, (rect.top - cropTop) * scale - 4 * scale);
      ctx.fillText("PinFix", labelX, labelY);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

async function captureScreenshot(rect) {
  if (!screenshotSetting) return "";
  const raw = await requestScreenshot();
  if (!raw) return "";
  return drawScreenshot(raw, rect);
}

function buildPrompt(description, anchor, rect, screenshotName) {
  const pos = rect ? `${Math.round(rect.left)}, ${Math.round(rect.top)} (${Math.round(rect.width)}×${Math.round(rect.height)})` : "";
  const lines = description.split("\n").filter((l) => l.trim());
  const problem = lines[0] || description;
  const expected = lines.length > 1 ? lines.slice(1).join(" ") : "";
  return [
    `- 问题：${problem}`,
    expected ? `- 期望：${expected}` : "",
    "请定位并修复以下前端页面问题：",
    `- 页面：${document.title ? `${document.title} (${location.href})` : location.href}`,
    anchor.file ? `- 源码：${anchor.file}${anchor.line ? `:${anchor.line}` : ""}` : "",
    anchor.label || anchor.selector ? `- 元素：${anchor.label || anchor.selector}` : "",
    anchor.path ? `- 选择器：${anchor.path}` : "",
    anchor.chain?.length ? `- 组件链：${anchor.chain.join(" > ")}` : "",
    pos ? `- 位置：${pos}` : "",
    anchor.text ? `- 文本：${anchor.text}` : "",
    anchor.layout ? `- 布局：${anchor.layout}` : "",
    screenshotName ? `- 截图：${screenshotName}（红框为问题区域）` : "",
  ].filter(Boolean).join("\n");
}
function announceDraft(msg) {
  let text = msg;
  if (text === lastNotice) text += "\u00A0";
  lastNotice = text;
  $("draft-meta").textContent = text;
}

$("draft-text").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229) return;
    $("draft-submit").click();
  }
});

$("note").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229) return;
    const issue = state.issues.find((item) => item.id === state.openId);
    if (issue) void act(issue, "feedback");
  }
});

$("draft-cancel").addEventListener("click", hideDraft);
$("draft-submit").addEventListener("click", async () => {
  const description = $("draft-text").value.trim();
  if (!description || !state.draft) return;
  const anchor = state.draft;
  const rect = state.draftRect;
  const screenshot = await captureScreenshot(rect);
  if (pageConnected()) {
    try {
      const issue = await api("/api/issues", {
        method: "POST",
        body: JSON.stringify({
          description,
          anchor,
          context: { url: location.href, diagnostics: diagnostics.slice(-10), ...(screenshot ? { screenshot } : {}) },
        }),
      });
      hideDraft();
      await refresh();
      openCard(issue.id);
      return;
    } catch {
      // ponytail: 未连接或请求失败时自动降级为复制提示词，无需额外配置开关
    }
  }
  try {
    let screenshotName = "";
    if (screenshot) {
      screenshotName = `pinfix-${Date.now()}.png`;
      downloadDataUrl(screenshotName, screenshot);
    }
    const copiedWithImage = await copyTextAndImage(buildPrompt(description, anchor, rect, screenshotName), screenshot);
    announceDraft(
      copiedWithImage
        ? "已复制提示词与截图到剪贴板"
        : screenshotName
          ? `已复制提示词，截图已保存到下载目录：${screenshotName}`
          : "已复制带页面与位置信息的提示词到剪贴板"
    );
    setTimeout(hideDraft, 900);
  } catch (error) {
    announceDraft(error instanceof Error ? error.message : String(error));
  }
});

function downloadDataUrl(name, dataUrl) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name;
  link.click();
}

document.addEventListener("pointermove", (event) => {
  if (!state.picking || state.gesture) return;
  if (event.composedPath().includes(host)) return;
  const element = elementAt(event.clientX, event.clientY);
  if (!element) return;
  if (element !== state.hoverEl) state.downStack = [];
  showHover(element);
}, true);

document.addEventListener("pointerdown", (event) => {
  if (!state.picking || event.composedPath().includes(host)) return;
  state.gesture = {
    x: event.clientX,
    y: event.clientY,
    id: event.pointerId,
    moved: false,
    target: state.hoverEl,
  };
}, true);

document.addEventListener("pointermove", (event) => {
  if (!state.gesture || event.pointerId !== state.gesture.id) return;
  const dx = event.clientX - state.gesture.x;
  const dy = event.clientY - state.gesture.y;
  if (Math.hypot(dx, dy) <= 4) return;
  state.gesture.moved = true;
  hideBoxes();
  placeRect($("rubber"), {
    left: Math.min(state.gesture.x, event.clientX),
    top: Math.min(state.gesture.y, event.clientY),
    width: Math.abs(dx),
    height: Math.abs(dy),
  });
}, true);

document.addEventListener("pointerup", (event) => {
  if (!state.gesture || event.pointerId !== state.gesture.id) return;
  const start = state.gesture;
  state.gesture = null;
  state.suppressClick = true;
  $("rubber").hidden = true;
  const selection = window.getSelection();
  const selectedText = selection && !selection.isCollapsed ? selection.toString().trim() : "";
  let anchor;
  let rect;
  if (selectedText && selection.rangeCount) {
    rect = selection.getRangeAt(0).getBoundingClientRect();
    const node = selection.anchorNode;
    anchor = anchorFrom(sourceElement(node), rect, "text", selectedText);
  } else if (start.moved) {
    rect = {
      left: Math.min(start.x, event.clientX),
      top: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    };
    const element = sourceElement(document.elementFromPoint(start.x + rect.width / 2, start.y + rect.height / 2));
    anchor = anchorFrom(element, rect, "region", "");
  } else {
    const element = (start.target?.isConnected && start.target) || state.hoverEl || elementAt(event.clientX, event.clientY);
    if (!element) return;
    selectElement(element);
    return;
  }
  showDraft(anchor, rect);
}, true);

document.addEventListener("click", (event) => {
  if (state.suppressClick) {
    state.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (state.picking && !event.composedPath().includes(host)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

document.addEventListener("pointerdown", (event) => {
  if ($("card").hidden) return;
  const path = event.composedPath();
  if (path.includes($("card")) || path.includes($("draft")) || path.some((node) => node.dataset?.issueId)) return;
  hideCard();
}, true);

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || shadow.activeElement === $("note") || shadow.activeElement === $("draft-text");
  if (!typing && state.picking && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    event.stopPropagation();
    moveHover(event.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (!typing && state.picking && event.key === "Enter" && state.hoverEl && $("draft").hidden) {
    event.preventDefault();
    selectElement(state.hoverEl);
    return;
  }
  if (event.key !== "Escape") return;
  if (!$("card").hidden) hideCard();
  else if (!$("draft").hidden) hideDraft();
  else if (state.picking) setPicking(false);
});

window.addEventListener("scroll", () => {
  renderMarks();
  if (state.picking && state.hoverEl?.isConnected) showHover(state.hoverEl, { keepCrumbs: true });
}, true);
window.addEventListener("resize", renderMarks);
let stream = null;
function syncLoop() {
  const next = sightloopConfig();
  if (next) {
    origin = String(next.origin || "").replace(/\/$/, "");
    token = String(next.token || "");
  }
  stream?.close();
  stream = null;
  if (pageConnected()) {
    stream = new EventSource(`${origin}/api/stream?token=${encodeURIComponent(token)}`);
    stream.onmessage = () => void refresh();
    void refresh();
  } else {
    state.issues = [];
    renderMarks();
  }
}
document.documentElement.addEventListener("sightloop-ready", syncLoop);
syncLoop();
}

function sightloopConfig() {
  if (window.__SIGHTLOOP__?.origin) {
    const cfg = { origin: window.__SIGHTLOOP__.origin, token: window.__SIGHTLOOP__.token || "" };
    if (document.documentElement) document.documentElement.dataset.sightloop = JSON.stringify(cfg);
    return cfg;
  }
  const raw = document.documentElement?.dataset?.sightloop;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function startSightloop() {
  if (document.getElementById("pinfix-host") || document.getElementById("sightloop-host")) return;
  const cfg = sightloopConfig();
  if (!cfg) return;
  bootSightloop(cfg);
}

document.documentElement.addEventListener("sightloop-ready", startSightloop);
startSightloop();
