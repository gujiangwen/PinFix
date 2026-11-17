import { describe, expect, it } from "vitest";
import {
  confidenceLevel,
  locationFromDebugSource,
  locationFromHeuristic,
  locationFromVueFile,
  normalizeRepoRelative,
  attachLocationToSniff,
  domFingerprint,
} from "./location.js";
import {
  extractSourceMappingUrl,
  parseInlineSourceMap,
  pickSourceForComponent,
} from "./source-map.js";
import { sniffElement } from "./index.js";

describe("location confidence", () => {
  it("maps score bands", () => {
    expect(confidenceLevel(0.9)).toBe("high");
    expect(confidenceLevel(0.5)).toBe("medium");
    expect(confidenceLevel(0.2)).toBe("low");
  });

  it("normalizes webpack/vite absolute paths", () => {
    expect(normalizeRepoRelative("/Users/me/app/src/ProductCard.tsx")).toBe(
      "src/ProductCard.tsx",
    );
  });

  it("fiber debugSource → high", () => {
    const loc = locationFromDebugSource({
      fileName: "/repo/src/ProductCard.tsx",
      lineNumber: 12,
      columnNumber: 3,
    });
    expect(loc.confidence_level).toBe("high");
    expect(loc.method).toBe("fiber_debug_source");
    expect(loc.file).toBe("src/ProductCard.tsx");
    expect(loc.line).toBe(12);
  });

  it("vue file → high", () => {
    const loc = locationFromVueFile("/src/PriceLabel.vue");
    expect(loc.confidence_level).toBe("high");
    expect(loc.method).toBe("vue_file");
  });

  it("component heuristic → low with alternates", () => {
    const loc = locationFromHeuristic({ componentName: "ProductCard" });
    expect(loc?.confidence_level).toBe("low");
    expect(loc?.method).toBe("component_heuristic");
    expect(loc?.alternates?.length).toBeGreaterThan(0);
  });
});

describe("source-map helpers", () => {
  it("extracts sourceMappingURL", () => {
    expect(
      extractSourceMappingUrl("foo();\n//# sourceMappingURL=app.js.map\n"),
    ).toBe("app.js.map");
  });

  it("parses inline data URL maps", () => {
    const json = JSON.stringify({
      version: 3,
      sources: ["webpack:///./src/ProductCard.tsx", "./src/other.ts"],
      mappings: "",
    });
    const dataUrl = `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
    const meta = parseInlineSourceMap(dataUrl);
    expect(meta?.sources[0]).toContain("ProductCard");
    const pick = pickSourceForComponent(meta!.sources, "ProductCard");
    expect(pick?.file).toContain("ProductCard");
    expect(pick!.confidence).toBeGreaterThanOrEqual(0.45);
  });
});

describe("sniffElement attaches location", () => {
  it("React Fiber gets high confidence location + fingerprint", () => {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    el.id = "react-target";
    document.body.appendChild(el);
    Object.defineProperty(el, "__reactFiber$test", {
      value: {
        type: function ProductCard() {},
        memoizedProps: {},
        _debugSource: {
          fileName: "/src/ProductCard.tsx",
          lineNumber: 12,
        },
        return: null,
      },
      configurable: true,
    });
    const result = sniffElement(el);
    expect(result.location?.confidence_level).toBe("high");
    expect(result.location?.method).toBe("fiber_debug_source");
    expect(result.fingerprint).toBeTruthy();
  });

  it("DOM-only gets low confidence placeholder", () => {
    document.body.innerHTML = `<button data-testid="save-btn">Save</button>`;
    const btn = document.querySelector("[data-testid=save-btn]")!;
    const result = sniffElement(btn);
    expect(result.framework).toBe("unknown");
    expect(result.location?.confidence_level).toBe("low");
    expect(result.location?.file).toBeTruthy();
  });

  it("attachLocationToSniff is idempotent when location exists", () => {
    const sniff = {
      framework: "unknown",
      selector: "#x",
      location: {
        file: "src/A.tsx",
        confidence: 1,
        confidence_level: "high" as const,
        method: "human" as const,
      },
    };
    const out = attachLocationToSniff(sniff);
    expect(out.location).toEqual(sniff.location);
  });

  it("domFingerprint is structural", () => {
    document.body.innerHTML = `<div class="wrap"><span data-testid="t" class="a b">hi</span></div>`;
    const el = document.querySelector("[data-testid=t]")!;
    const fp = domFingerprint(el);
    expect(fp).toContain("span");
    expect(fp).toContain("testid=t");
    expect(fp).not.toContain("hi");
  });
});
