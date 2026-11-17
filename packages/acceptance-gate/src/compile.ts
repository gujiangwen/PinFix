import { createHash } from "node:crypto";
import {
  type AcceptanceGateConfig,
  type Annotation,
  type ScenarioIR,
  type ScenarioStep,
  type StructuredExpect,
  DEFAULT_ACCEPTANCE_GATE_CONFIG,
} from "@sightloop/shared";
import { assertFixtureUrl } from "./url-guard.js";

export type CompileInput = {
  session_id: string;
  page_url: string;
  annotation?: Annotation | null;
  sniff?: unknown;
  config?: AcceptanceGateConfig;
};

export type CompileResult =
  | { ok: true; scenario: ScenarioIR; fingerprint: string }
  | { ok: false; code: string; message: string };

function extractExpects(
  annotation?: Annotation | null,
  sniff?: unknown,
): StructuredExpect[] {
  const fromAnn = annotation?.expects ?? [];
  if (fromAnn.length) return fromAnn;

  if (sniff && typeof sniff === "object" && !Array.isArray(sniff)) {
    const rec = sniff as Record<string, unknown>;
    if (Array.isArray(rec.expects)) {
      return rec.expects.filter(
        (e): e is StructuredExpect =>
          !!e &&
          typeof e === "object" &&
          typeof (e as StructuredExpect).type === "string",
      );
    }
  }
  return [];
}

function pickSelector(
  expect: StructuredExpect,
  annotation?: Annotation | null,
  sniff?: unknown,
): string | null {
  if (expect.selector) return expect.selector;
  if (annotation?.selector) return annotation.selector;
  if (sniff && typeof sniff === "object" && !Array.isArray(sniff)) {
    const sel = (sniff as { selector?: unknown }).selector;
    if (typeof sel === "string" && sel) return sel;
  }
  return null;
}

export function compileScenario(input: CompileInput): CompileResult {
  const config = input.config ?? DEFAULT_ACCEPTANCE_GATE_CONFIG;
  const urlCheck = assertFixtureUrl(input.page_url, config);
  if (!urlCheck.ok) {
    return { ok: false, code: urlCheck.code, message: urlCheck.message };
  }

  const expects = extractExpects(input.annotation, input.sniff);
  if (!expects.length) {
    return {
      ok: false,
      code: "compile_error",
      message:
        "No structured expects — provide annotation.expects[{type,selector?}]",
    };
  }

  const steps: ScenarioStep[] = [
    {
      id: "s0",
      action: "goto",
      value: urlCheck.url.toString(),
    },
  ];

  let i = 1;
  for (const exp of expects) {
    const selector = pickSelector(exp, input.annotation, input.sniff);
    if (!selector) {
      return {
        ok: false,
        code: "compile_error",
        message: `Expect ${exp.type} missing selector`,
      };
    }
    steps.push({
      id: `s${i}`,
      action: "wait_for",
      selector,
      annotation_ref: String(i),
    });
    i += 1;
    steps.push({
      id: `s${i}`,
      action: "assert_dom",
      selector,
      assert: { ...exp, selector },
      annotation_ref: String(i),
    });
    i += 1;
  }

  if (config.screenshot.enabled) {
    steps.push({
      id: `s${i}`,
      action: "screenshot",
      screenshot: { name: "viewport", target: "viewport" },
      annotation_ref: "shot",
    });
  }

  const scenario: ScenarioIR = {
    version: 1,
    session_id: input.session_id,
    start_url: urlCheck.url.toString(),
    viewport: { width: 1280, height: 720 },
    steps,
    gates: {
      dom: true,
      screenshot: config.screenshot.enabled,
      console: {
        fail_on_error: config.console.fail_on_error,
        fail_on_warning: config.console.fail_on_warning,
        ignore_patterns: config.console.ignore_patterns,
      },
      network: {
        fail_on_http_error: config.network.fail_on_http_error,
        ignore_url_patterns: config.network.ignore_url_patterns,
      },
    },
  };

  const fingerprint = fingerprintScenario(scenario);
  return { ok: true, scenario, fingerprint };
}

export function fingerprintScenario(scenario: ScenarioIR): string {
  const key = JSON.stringify({
    origin: new URL(scenario.start_url).origin,
    viewport: scenario.viewport,
    steps: scenario.steps.map((s) => ({
      action: s.action,
      selector: s.selector,
      assert: s.assert,
      screenshot: s.screenshot?.name,
    })),
    gates: scenario.gates,
  });
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}
