export function buildPrompt({ description, anchor = {}, rect = null, href = "", title = "", screenshotName = "" }) {
  const pos = rect ? `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}×${Math.round(rect.height)}` : "";
  const lines = String(description).split("\n").filter((l) => l.trim());
  const problem = lines[0] || description;
  const expected = lines.length > 1 ? lines.slice(1).join(" ").replace(/^期望[：:]\s*/, "") : "";
  // 有源码坐标或 Vue 组件链时省略冗长的 nth-of-type 选择器：智能体靠 源码+文本 即可锁定行号
  const hasPrecise = Boolean(anchor.file) || anchor.chain?.length;
  const items = [
    `问题：${problem}`,
    expected ? `期望：${expected}` : "",
    `页面：${title ? `${title} (${href})` : href}`,
    anchor.file ? `源码：${anchor.file}${anchor.line ? `:${anchor.line}` : ""}` : "",
    anchor.label || anchor.selector ? `元素：${anchor.label || anchor.selector}` : "",
    !hasPrecise && anchor.path ? `选择器：${anchor.path}` : "",
    anchor.chain?.length ? `组件链：${anchor.chain.join(" > ")}` : "",
    pos ? `位置：${pos}` : "",
    anchor.text ? `文本：${anchor.text}` : "",
    anchor.layout ? `布局：${anchor.layout}` : "",
    screenshotName ? `截图：${screenshotName}（红框为问题区域）` : "",
  ].filter(Boolean);
  return `请定位并修复以下前端页面问题：\n${items.map((item) => `- ${item}`).join("\n")}`;
}
