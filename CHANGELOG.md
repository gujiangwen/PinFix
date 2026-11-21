# 更新日志

本项目记录值得用户和贡献者注意的变更。版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-11-21

### 新增

- 独立的 Manifest V3 页面标注扩展，不再依赖 SightLoop 服务端打包。
- 元素、文字选区和拖拽区域标注，以及带页面上下文的提示词复制。
- 面向智能体的结构化锚点：源码坐标、元素路径、几何位置、文本快照与运行时错误。
- 可选 SightLoop 连接、问题提交、状态显示和人工处理操作。
- Chromium、Firefox 和 Safari 浏览器专用构建。
- 构建产物、浏览器清单和凭据隔离自检。
- Issue 与 Pull Request 模板，以及在 Node.js 22 上运行自检的 CI。

### 已知限制

- Firefox 和 Safari 仍需实机验收；Safari 分发需要 Xcode 转换、签名和 macOS App。
- 浏览器商店安装包尚未发布。
- 不支持移动端及浏览器限制的页面。

[0.3.0]: https://github.com/gujiangwen/PinFix/releases/tag/v0.3.0
