import { describe, expect, it } from "vitest";
import { compileScenario, fingerprintScenario } from "./compile.js";
import { assertFixtureUrl } from "./url-guard.js";
import { DEFAULT_ACCEPTANCE_GATE_CONFIG } from "@sightloop/shared";

describe("assertFixtureUrl", () => {
  it("allows loopback http fixture", () => {
    const r = assertFixtureUrl(
      "http://127.0.0.1:5175/",
      DEFAULT_ACCEPTANCE_GATE_CONFIG,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects https public hosts in fixture_only", () => {
    const r = assertFixtureUrl(
      "https://example.com/",
      DEFAULT_ACCEPTANCE_GATE_CONFIG,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects file://", () => {
    const r = assertFixtureUrl(
      "file:///tmp/x.html",
      DEFAULT_ACCEPTANCE_GATE_CONFIG,
    );
    expect(r.ok).toBe(false);
  });
});

describe("compileScenario", () => {
  it("compiles structured expects into wait+assert+screenshot", () => {
    const r = compileScenario({
      session_id: "s1",
      page_url: "http://127.0.0.1:5175/",
      annotation: {
        selector: "[data-testid=gate-ok]",
        expects: [{ type: "visible", selector: "[data-testid=gate-ok]" }],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenario.steps[0]?.action).toBe("goto");
    expect(r.scenario.steps.some((s) => s.action === "assert_dom")).toBe(true);
    expect(r.scenario.steps.some((s) => s.action === "screenshot")).toBe(true);
    expect(fingerprintScenario(r.scenario)).toHaveLength(24);
  });

  it("fails without expects", () => {
    const r = compileScenario({
      session_id: "s1",
      page_url: "http://127.0.0.1:5175/",
      annotation: { note: "no expects" },
    });
    expect(r.ok).toBe(false);
  });
});
