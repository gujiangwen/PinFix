# PinFix

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![CI](https://github.com/gujiangwen/PinFix/actions/workflows/ci.yml/badge.svg)](https://github.com/gujiangwen/PinFix/actions/workflows/ci.yml)

> **PinFix 是给智能体用的前端页面定位器**：把一句“这里有问题”，变成精确定位到**文件、行号、选择器和屏幕坐标**的可执行修复指令。

PinFix 是独立、开源的浏览器扩展，专为智能体修复 Web 前端 Bug 与做页面优化而设计。

使用 Claude Code、Cursor、Codex 等智能体改前端时，真正的瓶颈往往不是写代码，而是**让智能体准确知道该改哪里**：元素在 DOM 深处、类名混淆、组件层层嵌套，视觉问题（错位、溢出、遮挡）读代码根本看不出来，修复后又无法验证效果。PinFix 像一把瑞士军刀，把这类“定位成本”一次性解决——它既是智能体的眼睛，也是它与页面之间的接口。

## 智能体卡在哪里

| 智能体的困境 | PinFix 的应对 |
| --- | --- |
| 用户只说“按钮坏了”，不知道是哪个页面、哪个按钮 | 一键标注，直接锁定元素 |
| DOM 深层、组件嵌套，智能体只能全局搜索猜测 | 生成可复现的 CSS 选择器与元素路径 |
| 视觉问题读代码看不出来，也复现不了 | 记录元素几何位置、尺寸与文本快照 |
| 缺少源码坐标，改完不知道是否改对 | 提供 `文件:行号`，可精确到 Vue 组件文件 |
| 修复过程与结果对用户不可见 | 回显问题状态，支持确认、批准、回撤 |

## PinFix 给智能体什么

每次标注都会生成一份**结构化锚点**，这是智能体真正需要的输入：

```json
{
  "kind": "element",
  "file": "src/components/ProductCard.tsx",
  "line": 24,
  "label": "button.checkout",
  "path": ":scope > section:nth-of-type(1) > button:nth-of-type(1)",
  "selector": "button",
  "text": "立即购买",
  "box": { "x": 0.2, "y": 0.65, "w": 0.4, "h": 0.12 }
}
```

- **源码坐标**：文件路径与行号；页面提供 `data-sl-file` 标记或使用 Vue 时自动推断。
- **定位路径**：可复现的 CSS 选择器与元素层级路径，智能体无需在仓库里反复搜索。
- **几何信息**：相对坐标与尺寸，覆盖视觉类 Bug——溢出、重叠、错位、对比度。
- **文本快照**：元素当前文案，智能体据此判断语义是否正确。
- **运行时证据**：提交时附带最近 10 条页面错误，让智能体先看到真实报错再动手。

提示词模式下，这些信息会渲染成一段自然语言指令；SightLoop 模式下，它们以 JSON 直接进入修复流程。

## 两种工作模式

| 模式 | 适合 | 智能体拿到什么 |
| --- | --- | --- |
| **提示词模式** | 任意 AI 助手、任意项目 | 可直接粘贴的修复提示词，含页面 URL、源码位置、选择器、尺寸与文本 |
| **SightLoop 闭环模式** | 有本地开发环境的团队 | 结构化锚点直接进入问题工单，自动跟踪修复、验证、审核与回撤 |

提示词模式无需服务端，也不要求目标项目安装任何依赖。两种模式下 PinFix 都不会修改目标项目文件——它只负责**看清楚、指准确**。

## 核心能力

- 元素、文字选区与拖拽区域三种标注方式。
- 可选的标注时自动截图（带红框），随提示词或问题一并交付。
- 源码标记与 Vue 组件文件自动识别，给出 `文件:行号`。
- 页面内问题状态标记，支持追加反馈、批准方案、确认与回撤。
- 快捷键驱动的标注流程：键盘即可完成“定位 → 描述 → 交付”。
- Chromium、Firefox、Safari 三端构建共用一份源码，无第三方运行时依赖。

## 快速开始

### 环境要求

- Node.js 22 或更高版本，仅用于构建和测试。
- 一个支持 Manifest V3 的浏览器。

```sh
git clone https://github.com/gujiangwen/PinFix.git
cd PinFix
npm run build
npm run check
```

不想克隆仓库时，可直接下载源码包：[v0.3.0.tar.gz](https://github.com/gujiangwen/PinFix/archive/refs/tags/v0.3.0.tar.gz)。

无需先运行 `npm install`。`npm run check` 会构建全部浏览器目标，再运行产物与清单检查。生成目录为 `dist/chromium`、`dist/firefox` 和 `dist/safari`；这些目录不会提交到 Git。

只构建一个目标：

```sh
node scripts/build.js chromium
```

### 安装到浏览器

当前通过源码构建和开发者模式安装，尚未发布浏览器商店安装包。

**更新提醒**：扩展每次打开弹窗时会检查 GitHub 最新 Release，发现新版本会在弹窗顶部显示橙色升级横幅，点击直达下载页。无需手动去仓库查看是否有更新。

**Chrome / Edge / Brave / Opera**

1. 打开 `chrome://extensions` 或对应的扩展管理页。
2. 开启“开发者模式”，选择“加载已解压的扩展程序”。
3. 选择 `dist/chromium`。适用于 Chrome/Edge 111+ 及兼容的 Chromium 浏览器。

**Firefox 128+**

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 选择“临时载入附加组件”，再选择 `dist/firefox/manifest.json`。
3. 浏览器重启后需重新载入；正式分发需要签名。

**Safari 18+**

在 macOS 使用 Xcode 的 Safari Web Extension Packager 转换 `dist/safari`，完成签名后运行。Safari 构建目前未经过实机验收，正式分发还需要承载扩展的 macOS App。

### 开始标注

1. 打开普通 HTTP/HTTPS 页面；首次安装后已打开的页面需要刷新。
2. 点击 PinFix 扩展图标和“开始标注”。
   **快捷键**：`Alt+Shift+P` 开始/取消标注，可在 `chrome://extensions/shortcuts` 或浏览器对应页面自定义。
3. 单击元素，或拖拽选择区域；也可以先选中文字再点击。
4. 填写问题。提示词模式点击“复制提示词”；已接入服务时点击“提交”。
5. 把提示词交给智能体，或在 PinFix 中跟踪已提交问题的修复进度。

**设置入口**：点击扩展图标弹出后，点右上角的 ⚙️；或右键扩展图标 → 选项；或浏览器扩展管理页 → PinFix → 详情 → 扩展程序选项。

| 操作 | 快捷键 |
| --- | --- |
| 确认元素 / 提交当前描述 | `Enter` |
| 描述中换行 | `Shift + Enter` |
| 调整候选元素层级 | `↑` / `↓` |
| 取消标注或关闭编辑框 | `Esc` |
| 开始/取消标注 | `Alt+Shift+P` |

扩展设置页（右键扩展图标 → 选项）提供：

- **快捷键**：显示当前快捷键；修改需在 `chrome://extensions/shortcuts` 中完成（浏览器限制，扩展无法自行修改）。
- **SightLoop 接入**：直接填写服务地址与令牌并保存，无需跳转，保存后所有页面使用此连接。
- **标注截图**：开启后，标注时自动截可视区并画红框；提示词模式存到下载目录并在提示词中注明文件名，SightLoop 模式随问题提交。
  截图以问题元素为中心裁剪上下文（各方向外扩约 2 倍，夹在可视区内），图小、信号集中，便于智能体定位。

### 给智能体的提示词长什么样

```text
请定位并修复以下前端页面问题：
- 问题：按钮在窄屏下溢出容器
- 期望：按钮在窄屏下完整显示，不溢出容器
- 页面：示例页面 (https://example.com/products)
- 源码：src/ProductCard.tsx:24
- 元素：button.checkout
- 组件链：ProductCard.vue > CheckoutBar.vue
- 位置：640,420 120×40
- 文本：立即购买
- 布局：视口 1920×1080 | 元素 120×40 | display:flex overflow:hidden | 父容器 360×48
```

**说明**：
- 提示词只保留高价值字段，空字段自动省略；已有源码坐标或组件链时不再输出冗长的 `nth-of-type` 选择器。
- **期望**：交互/行为类问题建议在第二行写期望结果（可写「期望：…」，会自动归一），避免理解偏差。
- **组件链**：Vue 项目自动输出 2~4 层父组件链，样式 Bug 常根因在父组件。
- **框架适配**：开发态自动识别 Vue（`__vueParentComponent`）与 React（fiber `_debugSource`，含行号）的源码文件；其他框架或无源码标记时退化为选择器+文本模式。生产环境建议构建期注入 `data-sl-file` / `data-sl-line`。
- **布局**：布局/错位/空白类问题的关键快照（视口、元素尺寸、display/overflow/height、父容器尺寸）。
- **截图**：浏览器安全限制下扩展拿不到本地绝对路径；开启自动截图时，提示词与截图会一起写入剪贴板（支持富文本粘贴的输入框可直接收到图文），同时截图备份到下载目录。

浏览器内部页面、扩展商店和 PDF 阅读器等受限页面不能注入。移动端不在当前支持范围。

## SightLoop 是什么

SightLoop 是一个本地运行的「研发自愈」平台。在真实页面上发现问题之后,由本机守护进程驱动智能体定位源码、修改代码、执行校验、生成 diff,再交给人确认或回撤,最终把这次修复沉淀进可检索的知识库。

PinFix 负责闭环的第一环——**在浏览器里把问题定位到具体元素**;SightLoop 负责剩下的部分——**方案、实施、验证、评审、沉淀**。二者通过一套公开的 DOM 与 HTTP 协议对接,也可以各自独立使用。

| | PinFix | SightLoop |
| --- | --- | --- |
| 职责 | 定位问题、采集证据 | 推理改码、验证与评审 |
| 形态 | 浏览器扩展 | 本地守护进程 + Admin 控制台 |
| 是否必需 | 提示词模式只需它 | 闭环模式才需要 |

只想让智能体更快找到问题,装 PinFix 就够了;需要自动改代码、可验证、可回滚,再搭配 SightLoop。完整说明见 [SightLoop 是什么](docs/sightloop.md)。

## SightLoop 接入

不需要服务时无需任何配置。接入 SightLoop 有三种方式，按你的环境选择：

**方式一：页面内联配置（适合本地开发页面）**

在你的 HTML 或入口脚本中加入：

```html
<script>
  window.__SIGHTLOOP__ = {
    origin: "http://127.0.0.1:7788",
    token: "由本地服务签发的令牌"
  };
</script>
```

**方式二：控制台自动发现（适合 SightLoop Admin）**

SightLoop Admin 页面会在根元素提供 `data-sightloop-console` 并触发 `sightloop-console` 事件，PinFix 自动保存连接（最多 12 个 Loop）。

**方式三：DevTools 手动赋值（适合临时调试）**

在目标页面按 `F12` 打开控制台，执行：

```js
window.__SIGHTLOOP__ = { origin: "http://127.0.0.1:7788", token: "你的令牌" };
document.documentElement.dispatchEvent(new Event("sightloop-ready"));
```

刷新后 PinFix 会读取该配置。

也可以使用根元素 `data-sightloop`、控制台自动发现，以及 `data-sl-file` / `data-sl-line` 源码标记。连接匹配规则、接口契约和安全注意事项见 [SightLoop 接入指南](docs/sightloop-integration.md)。

**不要在公开网页中嵌入通用或高权限令牌。** 同主机名自动配对适用于可信本地开发环境；公开部署应使用明确的访问控制和最小权限凭据。

## 隐私与权限

- PinFix 没有遥测、分析服务或第三方账户系统。
- 提示词模式仅在用户操作后将页面上下文写入剪贴板。
- 接入 SightLoop 后，问题描述、标注信息和最近最多 10 条页面错误会发送到所连接的服务。
- 最多 12 个服务连接及其令牌保存在扩展本地存储中；不会写入构建产物。
- 可在浏览器扩展设置中清除站点数据，或卸载扩展清除本地记录。

详见[隐私与权限说明](docs/privacy.md)和[安全政策](SECURITY.md)。

## 文档

- [快速上手](docs/quickstart.md)：30 秒走完一次标注，含输出示例与快捷键。
- [开发与验证](docs/development.md)：目录、构建、测试和发布检查。
- [架构与迁移边界](docs/architecture.md)：模块职责、浏览器目标和兼容边界。
- [SightLoop 是什么](docs/sightloop.md)：自愈平台定位、组成与它和 PinFix 的分工。
- [SightLoop 接入](docs/sightloop-integration.md)：连接配置、源码标记和 HTTP/SSE 协议。
- [生产环境源码标记](docs/production-source-mark.md)：构建期注入 `data-sl-file`，让生产页面直达源码。
- [隐私与权限](docs/privacy.md)：数据处理、权限用途与清除方式。
- [贡献指南](CONTRIBUTING.md) · [行为准则](CODE_OF_CONDUCT.md) · [更新日志](CHANGELOG.md)

## 项目结构

```text
src/
  bridge.js       连接发现、本地存储和扩展消息
  widget.js       页面选择、提示词生成、提交与状态标记
  popup.*         浏览器工具栏弹窗
  manifest.json   共享 Manifest V3 配置
scripts/          构建与清理脚本
test/             产物、清单和凭据隔离自检
docs/             开发、集成与隐私文档
```

## 参与贡献

欢迎提交 Issue 和 Pull Request。开始修改前请阅读[贡献指南](CONTRIBUTING.md)，功能问题请附复现步骤，安全问题请按[安全政策](SECURITY.md)私下报告。

## 许可证

[MIT](LICENSE) © 2026 PinFix contributors。
