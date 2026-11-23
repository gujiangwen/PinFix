import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../src/prompt-core.js";

const anchor = {
  file: "frontend/src/views/PerformanceCharts.vue",
  line: 42,
  label: "div.charts-body.mode-split",
  path: ":scope > div:nth-of-type(1) > div:nth-of-type(3)",
  selector: "div",
  text: "待核对 81 笔",
  chain: ["TradeRecords.vue", "PerformanceCharts.vue"],
  layout: "视口 1920×1080 | 元素 1751×723 | display:flex | 父容器 1775×785",
};
const rect = { left: 100, top: 200, width: 1751, height: 723 };

test("prompt leads with problem and optional expectation", () => {
  const out = buildPrompt({
    description: "点击无响应\n期望：弹出当日证据弹窗",
    anchor, rect, href: "https://example.com/trades", title: "交易记录",
  });
  const lines = out.split("\n");
  assert.equal(lines[0], "请定位并修复以下前端页面问题：");
  assert.equal(lines[1], "- 问题：点击无响应");
  assert.equal(lines[2], "- 期望：弹出当日证据弹窗");
  assert.match(out, /- 页面：交易记录 \(https:\/\/example\.com\/trades\)/);
});

test("prompt omits long selector when precise source info exists", () => {
  const out = buildPrompt({ description: "底部空白太多", anchor, rect, href: "https://example.com", title: "" });
  assert.doesNotMatch(out, /选择器/);
  assert.match(out, /- 源码：frontend\/src\/views\/PerformanceCharts\.vue:42/);
  assert.match(out, /- 组件链：TradeRecords\.vue > PerformanceCharts\.vue/);
  assert.match(out, /- 布局：视口 1920×1080/);
});

test("prompt keeps selector when no source or chain available", () => {
  const bare = { label: "button.checkout", path: ":scope > button:nth-of-type(1)", selector: "button", text: "立即购买", chain: [], layout: "" };
  const out = buildPrompt({ description: "按钮错位", anchor: bare, rect, href: "https://example.com", title: "" });
  assert.match(out, /- 选择器：:scope > button:nth-of-type\(1\)/);
  assert.doesNotMatch(out, /组件链/);
});

test("prompt keeps empty fields out", () => {
  const out = buildPrompt({ description: "问题", anchor: {}, rect: null, href: "https://example.com", title: "" });
  for (const field of ["源码", "元素", "选择器", "组件链", "位置", "文本", "布局", "截图", "期望"]) {
    assert.doesNotMatch(out, new RegExp(`- ${field}`), field);
  }
  assert.match(out, /- 页面：https:\/\/example\.com/);
});
