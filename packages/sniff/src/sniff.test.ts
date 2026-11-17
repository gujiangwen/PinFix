import { describe, expect, it, beforeEach } from "vitest";
import { sniffElement } from "./index.js";

describe("sniffElement waterfall", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("falls back to generic DOM selector + truncated outerHTML", () => {
    document.body.innerHTML = `
      <div id="root">
        <button data-testid="save-btn" class="btn primary">Save</button>
      </div>
    `;
    const btn = document.querySelector("[data-testid=save-btn]")!;
    const result = sniffElement(btn);
    expect(result.framework).toBe("unknown");
    if (result.framework !== "unknown") throw new Error("expected unknown");
    expect(result.selector).toContain("data-testid");
    expect(result.domPath).toContain("button");
    expect(result.outerHTML.length).toBeGreaterThan(0);
    expect(result.tagName).toBe("button");
  });

  it("prefers React Fiber over DOM", () => {
    const el = document.createElement("div");
    el.id = "react-target";
    document.body.appendChild(el);

    const fiberKey = "__reactFiber$test";
    const fiber = {
      type: function ProductCard() {},
      key: "p1",
      memoizedProps: { title: "Widget", password: "nope" },
      _debugSource: {
        fileName: "/src/ProductCard.tsx",
        lineNumber: 12,
        columnNumber: 3,
      },
      return: {
        type: function App() {},
        memoizedProps: {},
        return: null,
      },
    };
    Object.defineProperty(el, fiberKey, { value: fiber, configurable: true });

    const result = sniffElement(el);
    expect(result.framework).toBe("react");
    if (result.framework !== "react") throw new Error("expected react");
    expect(result.componentStack[0]?.name).toBe("ProductCard");
    expect(result.componentStack[0]?.props?.password).toBe("[redacted]");
    expect(result.componentStack[1]?.name).toBe("App");
    expect(result.debugSource?.fileName).toBe("/src/ProductCard.tsx");
    expect(result.selector).toBe("#react-target");
  });

  it("detects Vue 3 when Fiber is absent", () => {
    const el = document.createElement("span");
    el.setAttribute("data-testid", "vue-label");
    document.body.appendChild(el);

    const instance = {
      type: { __name: "PriceLabel", __file: "/src/PriceLabel.vue" },
      props: { amount: 42, apiKey: "secret" },
      parent: {
        type: { name: "CheckoutPage" },
        props: {},
        parent: null,
      },
    };
    Object.defineProperty(el, "__vueParentComponent", {
      value: instance,
      configurable: true,
    });

    const result = sniffElement(el);
    expect(result.framework).toBe("vue3");
    if (result.framework !== "vue3") throw new Error("expected vue3");
    expect(result.componentStack[0]?.name).toBe("PriceLabel");
    expect(result.componentStack[0]?.file).toBe("/src/PriceLabel.vue");
    expect(result.componentStack[0]?.props?.apiKey).toBe("[redacted]");
    expect(result.componentStack[1]?.name).toBe("CheckoutPage");
  });

  it("React wins when both React and Vue markers exist", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    Object.defineProperty(el, "__reactFiber$x", {
      value: {
        type: function OnlyReact() {},
        memoizedProps: {},
        return: null,
      },
      configurable: true,
    });
    Object.defineProperty(el, "__vueParentComponent", {
      value: { type: { __name: "VueComp" }, props: {}, parent: null },
      configurable: true,
    });
    const result = sniffElement(el);
    expect(result.framework).toBe("react");
  });
});
