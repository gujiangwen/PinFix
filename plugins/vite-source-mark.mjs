// 生产构建期向 JSX/Vue 模板注入 data-sl-file / data-sl-line 源码标记。
// 让 PinFix 在生产部署的页面上也能直达源码，无需框架元数据。
//
// 用法（vite.config.js）：
//   import { sourceMark } from "./plugins/vite-source-mark.mjs";
//   export default defineConfig({ plugins: [sourceMark()] });
//
// 仅在显式开启时生效：sourceMark({ enabled: true }) 或 SOURCE_MARK=1。
// 生产代码默认不带标记，避免向最终用户暴露源码结构。

const JSX_RE = /\.[cm]?[jt]sx$/;

export function sourceMark(options = {}) {
  const enabled = options.enabled ?? process.env.SOURCE_MARK === "1";
  const root = options.root || process.cwd();
  const attr = options.attr || "data-sl";
  return {
    name: "pinfix-source-mark",
    enforce: "pre",
    transform(code, id) {
      if (!enabled) return null;
      if (!JSX_RE.test(id) || id.includes("node_modules")) return null;
      const rel = path_posix_relative(root, id);
      const marked = injectJsx(code, rel, attr);
      if (!marked || marked === code) return null;
      return { code: marked, map: null };
    },
  };
}

function path_posix_relative(root, id) {
  const r = id.replace(/\\/g, "/");
  const b = root.replace(/\\/g, "/");
  return r.startsWith(b) ? r.slice(b.length).replace(/^\//, "") : r;
}

// 在自闭合/开放 JSX 标签上注入 data-sl-file 与 data-sl-line。
// 只处理小写字母开头的宿主标签（<div>、<button>），跳过组件标签（<Card>），
// 因为最终渲染成 DOM 的是宿主标签。
function injectJsx(code, file, attr) {
  let out = "";
  let i = 0;
  let changed = false;
  let line = 1;
  const lineOf = (pos) => {
    line = 1;
    for (let k = 0; k < pos; k++) if (code[k] === "\n") line++;
    return line;
  };
  while (i < code.length) {
    const open = code.indexOf("<", i);
    if (open < 0) { out += code.slice(i); break; }
    const rest = code.slice(open);
    const m = rest.match(/^<([a-z][a-z0-9-]*)(\s|>|\/)/);
    if (!m || rest.includes(attr)) { out += code.slice(i, open + 1); i = open + 1; continue; }
    const tag = m[1];
    if (["html", "head", "body", "script", "style", "link", "meta", "title", "br", "hr", "img", "input"].includes(tag)) {
      out += code.slice(i, open + 1); i = open + 1; continue;
    }
    const ln = lineOf(open);
    out += code.slice(i, open) + `<${tag} ${attr}-file="${file}" ${attr}-line="${ln}"`;
    i = open + 1 + tag.length;
    changed = true;
  }
  return changed ? out : code;
}
