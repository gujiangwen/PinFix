# PinFix

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

PinFix 是独立、开源的浏览器页面标注扩展。选中元素、文字或区域，填写问题后即可复制包含页面 URL、源码位置、选择器、尺寸和文本的修复提示词；接入 SightLoop 时也可以直接提交问题并查看处理状态。

提示词模式不需要服务端，也不要求目标项目安装依赖。PinFix 不修改目标项目文件。

## 功能

- 元素、文字选区和拖拽区域标注。
- 生成包含页面与元素上下文的修复提示词，并复制到剪贴板。
- 可选接入 SightLoop，提交问题、追加反馈、批准方案、确认或回撤修改。
- 在页面上显示问题处理状态；源码标记可帮助定位对应文件。
- Chromium、Firefox 和 Safari 构建共用一份源码，无第三方运行时依赖。

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

无需先运行 `npm install`。`npm run check` 会构建全部浏览器目标，再运行产物与清单检查。生成目录为 `dist/chromium`、`dist/firefox` 和 `dist/safari`；这些目录不会提交到 Git。

只构建一个目标：

```sh
node scripts/build.js chromium
```

### 安装到浏览器

当前通过源码构建和开发者模式安装，尚未发布浏览器商店安装包。

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
3. 单击元素，或拖拽选择区域；也可以先选中文字再点击。
4. 填写问题。提示词模式点击“复制提示词”；已接入服务时点击“提交”。
5. 将提示词粘贴给你使用的编程助手，或在 PinFix 中查看已提交问题的进度。

| 操作 | 快捷键 |
| --- | --- |
| 确认元素 / 提交当前描述 | `Enter` |
| 描述中换行 | `Shift + Enter` |
| 调整候选元素层级 | `↑` / `↓` |
| 取消标注或关闭编辑框 | `Esc` |

复制的提示词示例：

```text
请定位并修复以下前端页面问题：
- 页面：示例页面 (https://example.com/products)
- 源码：src/ProductCard.tsx:24
- 元素：button.checkout
- 选择器：:scope > main > section:nth-of-type(1) > button:nth-of-type(1)
- 位置：640, 420 (120×40)
- 文本：立即购买
- 问题：按钮在窄屏下溢出容器
```

浏览器内部页面、扩展商店和 PDF 阅读器等受限页面不能注入。移动端不在当前支持范围。

## SightLoop 接入

不需要服务时无需任何配置。需要提交和跟踪问题时，页面可以提供：

```html
<script>
  window.__SIGHTLOOP__ = {
    origin: "http://127.0.0.1:7788",
    token: "由本地服务签发的令牌"
  };
</script>
```

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

- [开发与验证](docs/development.md)：目录、构建、测试和发布检查。
- [架构与迁移边界](docs/architecture.md)：模块职责、浏览器目标和兼容边界。
- [SightLoop 接入](docs/sightloop-integration.md)：连接配置、源码标记和 HTTP/SSE 协议。
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
