import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceMark } from "../plugins/vite-source-mark.mjs";

const plugin = sourceMark({ enabled: true, root: "/proj" });

test("injects data-sl markers into host JSX tags", () => {
  const code = `export function Card() {\n  return (\n    <div className="card">\n      <button onClick={buy}>立即购买</button>\n    </div>\n  );\n}`;
  const out = plugin.transform(code, "/proj/src/Card.jsx");
  assert.ok(out, "transform should return result");
  assert.match(out.code, /<div data-sl-file="src\/Card\.jsx" data-sl-line="3"/);
  assert.match(out.code, /<button data-sl-file="src\/Card\.jsx" data-sl-line="4"/);
});

test("skips component tags and void elements", () => {
  const code = `export function Page() {\n  return <section><Card /><br /><img src="a.png" /></section>;\n}`;
  const out = plugin.transform(code, "/proj/src/Page.jsx");
  assert.match(out.code, /<section data-sl-file/);
  assert.doesNotMatch(out.code, /<Card data-sl-file/);
  assert.doesNotMatch(out.code, /<br data-sl-file/);
  assert.doesNotMatch(out.code, /<img data-sl-file/);
});

test("disabled by default and skips non-jsx files", () => {
  const off = sourceMark();
  assert.equal(off.transform("<div/>", "/p/a.jsx"), null);
  assert.equal(plugin.transform("body{}", "/p/a.css"), null);
  assert.equal(plugin.transform("<div/>", "/proj/node_modules/x/a.jsx"), null);
});

test("does not double-inject", () => {
  const code = `<div data-sl-file="x" data-sl-line="1">ok</div>`;
  assert.equal(plugin.transform(code, "/proj/src/A.jsx"), null);
});
