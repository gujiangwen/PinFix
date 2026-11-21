# 开发与验证

## 环境

PinFix 是无第三方运行时依赖的原生 JavaScript 扩展。只需要 Node.js 22+ 来构建和运行自检，不需要 `npm install`、代码生成服务或 SightLoop 源码。

```sh
npm run build       # 构建三个浏览器目标
npm run check       # 构建并执行 node:test 自检
npm run clean       # 删除 dist/
node scripts/build.js firefox  # 仅构建一个目标
```

## 模块职责

| 文件 | 职责 |
| --- | --- |
| `src/bridge.js` | 隔离世界中的连接发现、连接存储、弹窗消息与配置桥接 |
| `src/widget.js` | 主世界中的元素选择、标注 UI、提示词、API 与 SSE |
| `src/popup.js` | 当前标签页状态检测和标注开关 |
| `src/manifest.json` | 共享 Manifest V3 配置 |
| `scripts/build.js` | 复制自包含源码，并生成浏览器专用清单 |

`dist/` 完全由 `src/` 和构建脚本生成，不应手动修改或提交。

## 验证改动

先运行与改动最接近的自动化检查，再根据影响范围做浏览器验证。当前自检只验证构建产物和清单，不代替真实浏览器中的交互测试。

仓库内置 GitHub Actions（`.github/workflows/ci.yml`）：推送 `main` 与任意 Pull Request 都会在 Node.js 22 上运行 `npm run check`，无需安装依赖。提交前本地跑一次同样的命令，可以避免把失败留给 CI。

### 最小手动检查

1. 构建并在目标浏览器中重新加载扩展，然后刷新测试页面。
2. 在提示词模式下分别选择元素、文字和区域，检查提示词字段和剪贴板结果。
3. 检查 `Enter`、`Shift+Enter`、方向键和 `Esc`，以及滚动或改变窗口大小后的标注位置。
4. 如果修改连接逻辑，验证未连接、显式配置、控制台发现和同主机名自动配对。
5. 如果修改 SightLoop 协议，验证提交、反馈、批准、确认、回撤、关闭和 SSE 刷新。
6. 确认控制台没有扩展相关异常，并检查失败请求是否安全降级为提示词复制。

在 Pull Request 中列出实际运行的命令、浏览器版本和手动检查范围。未测试的浏览器应明确标记，不要把构建成功等同于浏览器验收。

## 发布检查

1. 更新 `package.json` 和 `src/manifest.json` 中一致的版本号。
2. 更新 `CHANGELOG.md` 和受影响的文档。
3. 运行 `npm run clean && npm run check`。
4. 确认 CI 通过，并从干净产物手动验证目标浏览器，检查清单权限和凭据隔离。
5. 提交改动、创建 `v<版本>` 标签，再在 GitHub Release 中附上变更说明和验收范围。

Safari 发布还需在 macOS 上转换、签名和实机验收。Firefox 正式发布需要签名。商店分发包和签名产物不包含在当前构建脚本中。
