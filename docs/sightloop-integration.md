# SightLoop 接入指南

PinFix 默认使用提示词模式，不需要 SightLoop。接入兼容服务后，结构化锚点会直接进入问题工单，由服务侧的智能体完成定位、修复与验证，同时支持人工确认、批准与回撤。PinFix 通过公开 DOM 和 HTTP 协议集成，不引用 SightLoop 源码。

SightLoop 本身是什么、它和 PinFix 如何分工，见 [SightLoop 是什么](sightloop.md)。

## 页面显式配置

在页面脚本中设置：

```js
window.__SIGHTLOOP__ = {
  origin: "http://127.0.0.1:7788",
  token: "由服务签发的最小权限令牌"
};
```

或者在 HTML 根元素提供等价 JSON。属性值中的引号需要正确转义：

```html
<html data-sightloop='{"origin":"http://127.0.0.1:7788","token":"最小权限令牌"}'>
```

`origin` 是服务源，不包含末尾 `/`；`token` 用于 Bearer 身份验证和 SSE 连接。配置不完整时仍可使用提示词模式。

### 临时调试：DevTools 手动赋值

如果不想修改页面代码，可以在目标页面打开 DevTools 控制台执行：

```js
window.__SIGHTLOOP__ = {
  origin: "http://127.0.0.1:7788",
  token: "你的令牌"
};
document.documentElement.dispatchEvent(new Event("sightloop-ready"));
```

刷新后 PinFix 会读取该配置。此方式适合临时调试，刷新后需重新赋值。

## 控制台发现与自动配对

SightLoop 控制台可在根元素提供连接信息，并触发事件：

```js
document.documentElement.dataset.sightloopConsole = JSON.stringify({
  origin: location.origin,
  token: "由服务签发的最小权限令牌"
});
document.documentElement.dispatchEvent(new Event("sightloop-console"));
```

扩展最多保存 12 个最近使用的连接。控制台自身不会自动启用页面标注。普通网页只有在存在 `data-sl-file` 源码标记时，才会按**相同主机名**匹配已保存的连接；不同端口仍可能匹配，因此该机制只适用于可信环境。

不要在这些 DOM 属性或事件中放置公开可用的通用凭据。页面脚本能够读取根元素数据，所有页面集成都应被视为运行在目标页面的信任边界内。

## 源码标记

开发服务器可将源码位置写到对应元素：

```html
<button data-sl-file="src/ProductCard.tsx" data-sl-line="24">
  立即购买
</button>
```

PinFix 优先使用这些标记定位源码，也会尝试读取 Vue 组件的 `__file`。没有源码标记时仍可选择元素并生成 DOM 选择器，只是提示词中可能没有文件路径。建议仅在开发构建中输出源码标记。

`sightloop-extension`、`sightloop-ready` 和 `sightloop-command` 等名称是内部兼容协议，不是目标页面需要实现的公共 API。

## 服务协议

所有 HTTP JSON 请求使用 `Authorization: Bearer <token>`；写请求使用 `Content-Type: application/json`。服务需要允许目标网页访问 API，并正确处理身份验证与 CORS。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/meta` | 弹窗检查服务连接 |
| `GET /api/issues` | 获取当前可见问题列表 |
| `POST /api/issues` | 创建问题 |
| `POST /api/issues/:id/feedback` | 追加描述，正文为 `{"text":"..."}` |
| `POST /api/issues/:id/confirm` | 确认修改，正文为 `{}` |
| `POST /api/issues/:id/approve` | 批准方案，正文为 `{}` |
| `POST /api/issues/:id/revert` | 回撤已应用修改，正文为 `{}` |
| `POST /api/issues/:id/close` | 关闭问题，正文为 `{}` |
| `GET /api/stream?token=<token>` | SSE；收到消息时刷新问题 |

创建问题的请求示例：

```json
{
  "description": "按钮在窄屏下溢出容器",
  "anchor": {
    "kind": "element",
    "file": "src/ProductCard.tsx",
    "line": 24,
    "label": "button.checkout",
    "path": ":scope > button:nth-of-type(1)",
    "selector": "button",
    "text": "立即购买",
    "box": { "x": 0, "y": 0, "w": 1, "h": 1 }
  },
  "context": {
    "url": "https://example.com/products",
    "diagnostics": []
  }
}
```

若用户在扩展设置中开启了「标注时自动截图」，`context` 会额外携带 `screenshot`（PNG data URL），内容为可视区截图并在问题区域画有红框。服务端可按需保存或忽略。

创建接口应返回包含 `id` 的问题对象。列表项可包含 `id`、`title`、`description`、`status`、`anchor`、`source`、`error`、`plan`、`change`、`review`、`events` 和 `patch_applied`。PinFix 显示 `pending`、`analyzing`、`awaiting_plan_approval`、`ready_to_fix`、`fixing`、`reviewing`、`awaiting_confirm`、`needs_human` 和 `reverted` 状态。

非成功 HTTP 响应应返回 JSON 错误对象，例如 `{"error":"..."}`。提交失败时 PinFix 会尝试降级为复制提示词，但服务端应正确使用状态码，避免将失败响应当作成功。

## 安全清单

- 服务默认绑定可信接口；本地服务优先使用回环地址。
- 使用最小权限、可撤销令牌，不在公开客户端代码中嵌入通用凭据。
- 对请求来源和身份进行验证，不因页面提供了配置就授予额外权限。
- 对 `/api/stream` 使用同样的访问控制；SSE 不支持当前客户端自定义请求头，因此令牌会出现在 URL 中，应避免记录和泄露该 URL。
- 生产环境使用 HTTPS，并严格配置 CORS 和服务端审计。
