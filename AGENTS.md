# PinFix 协作约定

## 项目性质

PinFix 是面向智能体的 Web 前端页面定位与标注扩展：把页面上的问题定位成包含源码坐标、元素路径、几何位置和文本快照的结构化锚点，交给智能体修复。

## 命令

```sh
npm run build     # 构建 dist/chromium、dist/firefox、dist/safari
npm run check     # 构建并运行 node:test 自检（4 项）
npm run clean     # 删除 dist/
```

- 零第三方依赖，不需要 `npm install`。
- `dist/` 是生成产物，不要提交或手动修改。
- 改动 `src/` 后至少跑 `npm run check`；涉及交互的改动还需在浏览器手动验证。

## 代码约定

- `src/bridge.js` 运行在隔离世界，只负责连接发现、本地存储与消息桥接。
- `src/widget.js` 运行在主世界（`world: "MAIN"`），负责页面选择、提示词与 API 调用。
- 三个浏览器目标共用一份源码，清单差异由 `scripts/build.js` 生成。
- 保持 `sightloop-*` 兼容协议名称不变，产品名与扩展 ID 使用 PinFix。
- 不要在构建产物中写入服务地址或凭据。

## 文档

- `README.md` 是对外入口，定位描述与文档导航需保持同步。
- `docs/` 按主题拆分：开发、集成、隐私、架构；新增文档要接入 README 导航。
- 仓库文档为中文，代码注释只在解释“为什么”时写一行。

## 提交约定

- 每完成一项功能或修复，直接提交并推送到 `origin/main`，不再逐次询问。
- 提交信息用祈使句，可带 `feat:`、`fix:`、`docs:`、`test:` 等前缀。
- 推送前确认 `npm run check` 通过。
