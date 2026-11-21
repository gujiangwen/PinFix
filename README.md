# PinFix

PinFix 是独立的浏览器页面标注扩展。选中元素、文字或区域，填写问题后即可复制包含页面 URL、源码位置、选择器、尺寸和文本的修复提示词；接入 SightLoop 时也可以直接提交问题并查看处理状态。

不依赖 Node 服务、SightLoop 源码或目标网站构建工具即可使用提示词模式。运行时不修改目标项目文件。

## 构建

需要 Node.js 22+，无第三方依赖：

```sh
npm run build
npm run check
```

输出目录：`dist/chromium`、`dist/firefox`、`dist/safari`。也可只构建一个目标，例如 `node scripts/build.js firefox`。

## 安装

### Chrome / Edge / Brave / Opera

1. 打开浏览器的扩展管理页，例如 `chrome://extensions` 或 `edge://extensions`。
2. 开启开发者模式，选择「加载已解压的扩展程序」。
3. 选择 `dist/chromium`。支持 Chrome/Edge 111+ 及相近版本的 Chromium。

### Firefox 128+

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 选择「临时载入附加组件」，再选择 `dist/firefox/manifest.json`。
3. 临时扩展在浏览器重启后需要重新载入；长期使用需通过 Firefox 签名分发。

### Safari 18+（第二阶段）

在 macOS 使用 Xcode 的 Safari Web Extension Packager 转换 `dist/safari`，完成签名和实机验证后运行。当前 Windows 环境无法宣称 Safari 已验收；对外分发还需要包含扩展的 macOS App。

## 使用

1. 打开普通 HTTP/HTTPS 页面，点击 PinFix 扩展图标和「开始标注」。
2. 单击元素，或拖拽选择区域，也可以先选中文字再点击。
3. 填写问题；未接入服务时点击「复制提示词」，接入后点击「提交」。
4. `Esc` 取消；标注时使用上下方向键调整元素层级，`Enter` 选择。

浏览器内部页面、扩展商店、PDF 阅读器等受限页面不能注入。移动端不在当前支持范围。

## SightLoop 接入

PinFix 与 SightLoop 通过以下公开协议连接，不引用 SightLoop 项目源码：

- 页面提供 `window.__SIGHTLOOP__ = { origin, token }`，或根元素 `data-sightloop` 的同结构 JSON。
- 控制台根元素提供 `data-sightloop-console`，并触发 `sightloop-console` 事件；扩展保存该连接，最多记录 12 个 Loop。
- 带 `data-sl-file` 的同主机名页面可自动匹配已保存的 Loop；其他网页保持提示词模式。
- 服务实现 SightLoop 的 `/api/issues`、`/api/issues/:id/*`、`/api/meta`、`/api/stream` 协议。
- 为精确定位源码，目标页面可提供 `data-sl-file` 和 `data-sl-line`。

连接记录包含访问令牌，保存在扩展本地存储中，不会写入构建文件。卸载扩展可清除这些记录。

## 文件

- `src/bridge.js`：连接发现、本地存储和扩展消息。
- `src/widget.js`：页面选择、提示词生成、提交与状态标记。
- `src/popup.*`：浏览器工具栏弹窗。
- `scripts/build.js`：共享源码的浏览器专用构建。
- `test/build.test.js`：产物、清单和凭据隔离自检。
