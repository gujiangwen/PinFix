# 架构与迁移边界

PinFix 是从 SightLoop 迁出的独立扩展，不再由 SightLoop 服务端打包或提供下载。

产品定位是智能体修复 Web 前端 Bug 与做页面优化的辅助工具：扩展负责在真实页面上定位元素并采集源码坐标、选择器、几何位置与文本快照，智能体负责据此推理与修改。PinFix 不实现修复逻辑，也不修改目标项目文件；提示词模式把采集结果渲染成自然语言指令，SightLoop 模式把同一份结构化锚点交给闭环修复流程。

## 所有权

- PinFix：扩展清单、页面组件、弹窗、连接存储、跨浏览器构建和测试。
- SightLoop：问题 API、修复流程、控制台，以及开发态 Vite 源码标记/脚本注入。

`window.__SIGHTLOOP__`、`data-sightloop*` 和 `sightloop-*` DOM 事件是兼容协议，保留名称以避免破坏现有接入页面；产品名称和扩展 ID 使用 PinFix。

## 构建与分发

三个目标共享同一份源码，仅清单不同。Firefox 128 起原生支持 `content_scripts.world: "MAIN"`，不需要脚本元素注入或 polyfill。Safari 18 是第二阶段基线，需用 Xcode 转换并在 macOS 实机验证。

开发、测试和发布步骤见[开发与验证](development.md)，HTTP 与 DOM 集成契约见 [SightLoop 接入指南](sightloop-integration.md)。

## 验证记录

- 2026-11-21：从 SightLoop 工作区迁入完整扩展功能，独立构建与四项 `node:test` 自检通过，SightLoop TypeScript 编译通过。
- 当前 Chrome 命令行测试环境未实际登记新加载的本地扩展，因此不把页面注入验收记为通过；需在扩展管理页手动加载后再验收。Firefox 和 Safari 同样待实机验收。
