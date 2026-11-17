import {
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { chromium, type ConsoleMessage, type Response } from "playwright";
import type {
  AcceptanceCheckKind,
  AcceptanceFailedStep,
  AcceptanceGateConfig,
  AcceptanceReport,
  ScenarioIR,
} from "@sightloop/shared";
import { comparePng, baselinePngPath } from "./compare.js";

export type RunGateInput = {
  run_id: string;
  session_id: string;
  project_id: string;
  scenario: ScenarioIR;
  fingerprint: string;
  config: AcceptanceGateConfig;
  /** Absolute root for data/acceptance-gates */
  artifactsRoot: string;
  temp_commit_sha?: string | null;
  headed?: boolean;
  onProgress?: (p: {
    step_index: number;
    step_total: number;
    label: string;
  }) => void;
};

function matchIgnore(url: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    // simple glob: **foo** → includes
    const bare = p.replace(/\*\*/g, "").replace(/\*/g, "");
    if (!bare) return false;
    return url.includes(bare);
  });
}

export async function runAcceptanceGate(
  input: RunGateInput,
): Promise<AcceptanceReport> {
  const started = Date.now();
  const runDir = join(
    input.artifactsRoot,
    "runs",
    input.session_id,
    input.run_id,
  );
  mkdirSync(runDir, { recursive: true });
  const baselinesRoot = join(input.artifactsRoot, "baselines");

  const failedChecks = new Set<AcceptanceCheckKind>();
  const failedSteps: AcceptanceFailedStep[] = [];
  const consoleErrors: string[] = [];
  const networkFailures: Array<{
    method: string;
    url: string;
    status: number;
  }> = [];
  const screenshots: AcceptanceReport["screenshots"] = [];

  let browser;
  try {
    browser = await chromium.launch({
      headless: !(input.headed ?? false),
    });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const hint = message.includes("Executable doesn't exist")
      ? " — run: pnpm exec playwright install chromium"
      : "";
    return {
      run_id: input.run_id,
      session_id: input.session_id,
      status: "error",
      failed_checks: [],
      failed_steps: [],
      console_errors: [],
      network_failures: [],
      screenshots: [],
      duration_ms: Date.now() - started,
      error: `Playwright launch failed${hint}: ${message}`,
      start_url: input.scenario.start_url,
      fingerprint: input.fingerprint,
      temp_commit_sha: input.temp_commit_sha ?? null,
    };
  }

  try {
    const context = await browser.newContext({
      viewport: input.scenario.viewport,
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();

    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (
          !matchIgnore(text, input.scenario.gates.console.ignore_patterns)
        ) {
          consoleErrors.push(text.slice(0, 500));
        }
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(String(err.message ?? err).slice(0, 500));
    });
    page.on("response", (res: Response) => {
      const status = res.status();
      if (status < 400) return;
      const url = res.url();
      if (
        matchIgnore(url, input.scenario.gates.network.ignore_url_patterns)
      ) {
        return;
      }
      networkFailures.push({
        method: res.request().method(),
        url: url.slice(0, 500),
        status,
      });
    });

    const total = input.scenario.steps.length;
    for (let idx = 0; idx < input.scenario.steps.length; idx += 1) {
      const step = input.scenario.steps[idx]!;
      input.onProgress?.({
        step_index: idx + 1,
        step_total: total,
        label: `${step.action}${step.selector ? ` ${step.selector}` : ""}`,
      });

      try {
        if (step.action === "goto") {
          const target = step.value ?? input.scenario.start_url;
          await page.goto(target, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });
          continue;
        }

        if (step.action === "wait_for" && step.selector) {
          await page.locator(step.selector).first().waitFor({
            state: "attached",
            timeout: 10_000,
          });
          continue;
        }

        if (step.action === "click" && step.selector) {
          await page.locator(step.selector).first().click({ timeout: 10_000 });
          continue;
        }

        if (step.action === "fill" && step.selector) {
          await page
            .locator(step.selector)
            .first()
            .fill(step.value ?? "", { timeout: 10_000 });
          continue;
        }

        if (step.action === "hover" && step.selector) {
          await page.locator(step.selector).first().hover({ timeout: 10_000 });
          continue;
        }

        if (step.action === "assert_dom" && step.assert && step.selector) {
          const loc = page.locator(step.selector);
          const kind = step.assert.type;
          if (kind === "visible") {
            await loc.first().waitFor({ state: "visible", timeout: 10_000 });
          } else if (kind === "hidden") {
            await loc.first().waitFor({ state: "hidden", timeout: 10_000 });
          } else if (kind === "text_contains") {
            const text = await loc.first().innerText({ timeout: 10_000 });
            const expected = String(step.assert.expected ?? "");
            if (!text.includes(expected)) {
              throw new Error(
                `text_contains failed: expected «${expected}» in «${text.slice(0, 120)}»`,
              );
            }
          } else if (kind === "attr_equals") {
            const attr = step.assert.attr ?? "value";
            const actual = await loc.first().getAttribute(attr, {
              timeout: 10_000,
            });
            if (actual !== String(step.assert.expected ?? "")) {
              throw new Error(
                `attr_equals ${attr}: expected «${step.assert.expected}» got «${actual}»`,
              );
            }
          } else if (kind === "count_equals") {
            const count = await loc.count();
            const expected = Number(step.assert.expected ?? 0);
            if (count !== expected) {
              throw new Error(`count_equals: expected ${expected} got ${count}`);
            }
          }
          continue;
        }

        if (step.action === "screenshot" && step.screenshot) {
          const name = step.screenshot.name;
          const actualPath = join(runDir, `${name}.actual.png`);
          if (step.screenshot.target === "locator" && step.selector) {
            await page.locator(step.selector).first().screenshot({
              path: actualPath,
              animations: "disabled",
            });
          } else {
            await page.screenshot({
              path: actualPath,
              fullPage: step.screenshot.target === "fullpage",
              animations: "disabled",
            });
          }
          const baselinePath = baselinePngPath(
            baselinesRoot,
            input.project_id,
            input.fingerprint,
            name,
          );
          const diffPath = join(runDir, `${name}.diff.png`);
          const cmp = comparePng(
            actualPath,
            baselinePath,
            diffPath,
            input.config.screenshot.max_diff_pixel_ratio,
          );
          screenshots.push({
            name,
            passed: cmp.passed,
            diff_ratio: cmp.diffRatio,
            baseline_created: cmp.baselineCreated,
          });
          if (!cmp.passed) {
            failedChecks.add("screenshot");
            failedSteps.push({
              id: step.id,
              message: `screenshot ${name} diff_ratio=${cmp.diffRatio.toFixed(4)}`,
              check: "screenshot",
            });
          }
          continue;
        }
      } catch (err) {
        failedChecks.add("dom");
        failedSteps.push({
          id: step.id,
          message: (err as Error).message ?? String(err),
          check: "dom",
        });
        // fail-fast for DOM
        break;
      }
    }

    if (
      input.scenario.gates.console.fail_on_error &&
      consoleErrors.length > 0
    ) {
      failedChecks.add("console");
      failedSteps.push({
        id: "console",
        message: consoleErrors[0]!,
        check: "console",
      });
    }

    if (
      input.scenario.gates.network.fail_on_http_error &&
      networkFailures.length > 0
    ) {
      failedChecks.add("network");
      failedSteps.push({
        id: "network",
        message: `${networkFailures[0]!.status} ${networkFailures[0]!.method} ${networkFailures[0]!.url}`,
        check: "network",
      });
    }

    await context.close();
  } finally {
    await browser.close().catch(() => undefined);
  }

  const status = failedChecks.size || failedSteps.length ? "failed" : "passed";
  const refineParts = [
    "Browser acceptance gate failed:",
    ...failedSteps.map((s) => `- [${s.id}] ${s.message}`),
  ];

  const report: AcceptanceReport = {
    run_id: input.run_id,
    session_id: input.session_id,
    status,
    failed_checks: [...failedChecks],
    failed_steps: failedSteps,
    console_errors: consoleErrors.slice(0, 20),
    network_failures: networkFailures.slice(0, 20),
    screenshots,
    duration_ms: Date.now() - started,
    refine_note_draft: status === "failed" ? refineParts.join("\n") : undefined,
    error: null,
    start_url: input.scenario.start_url,
    fingerprint: input.fingerprint,
    temp_commit_sha: input.temp_commit_sha ?? null,
  };

  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(runDir, "console.json"),
    JSON.stringify(consoleErrors, null, 2),
  );
  writeFileSync(
    join(runDir, "network.json"),
    JSON.stringify(networkFailures, null, 2),
  );

  return report;
}

export function resolveArtifactPath(
  artifactsRoot: string,
  sessionId: string,
  runId: string,
  name: string,
): string | null {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return null;
  }
  const full = join(artifactsRoot, "runs", sessionId, runId, name);
  if (!full.startsWith(join(artifactsRoot, "runs"))) return null;
  return existsSync(full) ? full : null;
}
