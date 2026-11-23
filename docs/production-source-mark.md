# 生产环境源码标记

开发态下 PinFix 能经 Vue / React 的框架元数据拿到源码坐标；生产构建会剥离这些信息，导致标注退化为「选择器 + 文本」模式。`plugins/vite-source-mark.mjs` 在构建期把源码位置写进 HTML 属性，让生产页面同样可直达源码。

## 用法

```js
// vite.config.js
import { defineConfig } from "vite";
import { sourceMark } from "./plugins/vite-source-mark.mjs";

export default defineConfig({
  plugins: [sourceMark()],
});
```

默认关闭，避免把源码结构暴露给最终用户。开启方式：

```sh
SOURCE_MARK=1 vite build        # 临时开启
```

或 `sourceMark({ enabled: true })` 固化到配置。

## 注入效果

```jsx
// 源码
<button onClick={buy}>立即购买</button>

// 构建后（行号对应源码行）
<button data-sl-file="src/ProductCard.jsx" data-sl-line="24" onClick={buy}>立即购买</button>
```

PinFix 读取 `data-sl-file` / `data-sl-line` 后，提示词里直接带 `源码：src/ProductCard.jsx:24`，不再依赖框架运行时。

## 边界

- 只注入小写宿主标签（`div`、`button`、`section` 等），跳过组件标签（`<Card>`）与空元素（`img`、`br`、`input` 等）。
- 已带 `data-sl-` 的节点不重复注入。
- 适用于 React（`.jsx/.tsx`）与任何经 Vite 编译的 JSX 系框架；Vue 单文件组件的模板部分不经过此插件，Vue 项目生产标记需用 `vite-plugin-vue-inspector` 类工具。
- 注入会让 HTML 体积略增，且源码路径会出现在最终页面中——仅建议在内部工具或受控环境开启。

## 无构建接入

如果不便改构建配置，可让页面框架在渲染时输出等价属性，或直接使用开发态（框架元数据已够用）。契约见 [SightLoop 接入指南](sightloop-integration.md)。
