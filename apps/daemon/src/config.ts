import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { findMonorepoRoot, resolveFromRoot } from "./paths.js";
import type { MarkupAdapterKind } from "@sightloop/markup-bridge";

loadEnv({ path: resolve(findMonorepoRoot(), ".env") });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function parseRoots(): string[] {
  const raw =
    process.env.SIGHTLOOP_ALLOWED_ROOTS ??
    process.env.PINFIX_ALLOWED_ROOTS ??
    "";
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => resolve(p));
  if (parts.length === 0) {
    throw new Error(
      "Set SIGHTLOOP_ALLOWED_ROOTS (or PINFIX_ALLOWED_ROOTS) to a comma-separated list of absolute path prefixes",
    );
  }
  return parts;
}

export type DaemonConfig = {
  host: string;
  port: number;
  token: string;
  allowedRoots: string[];
  dbPath: string;
  version: string;
  markupWorkspaceRoot: string;
  lockDir: string;
  markupAdapter: MarkupAdapterKind;
  markupLicenseKey?: string;
  /** Local DX: allow POST /v1/dx/bootstrap to return the loopback token. */
  dxBootstrap: boolean;
  dxLabel: string;
  /** M9 LangGraph dual-loop (default off). */
  dualLoop: boolean;
  dualLoopMock: boolean;
  maxInnerRefines: number;
  maxPlanAttempts: number;
  plannerModel: string | null;
  implementerModel: string | null;
  reviewerModel: string | null;
  plannerKeyConfigured: boolean;
  reviewerKeyConfigured: boolean;
};

export function loadConfig(): DaemonConfig {
  const host = process.env.SIGHTLOOP_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.warn(
      `[sightloop] WARNING: binding to non-loopback host ${host}; prefer 127.0.0.1`,
    );
  }

  const adapterRaw = (process.env.MARKUP_ADAPTER ?? "self").toLowerCase();
  const markupAdapter: MarkupAdapterKind =
    adapterRaw === "official" ? "official" : "self";

  const plannerKeyConfigured = Boolean(
    process.env.SIGHTLOOP_PLANNER_API_KEY?.trim(),
  );
  const reviewerKeyConfigured = Boolean(
    process.env.SIGHTLOOP_REVIEWER_API_KEY?.trim() ||
      process.env.SIGHTLOOP_PLANNER_API_KEY?.trim(),
  );

  return {
    host,
    port: Number.parseInt(process.env.SIGHTLOOP_PORT ?? "7420", 10),
    token: required("SIGHTLOOP_TOKEN", "dev-token-change-me"),
    allowedRoots: parseRoots(),
    dbPath: resolveFromRoot(
      process.env.SIGHTLOOP_DB_PATH ?? "./data/projects.sqlite",
    ),
    version: "0.11.0",
    markupWorkspaceRoot: resolveFromRoot(
      process.env.MARKUP_WORKSPACE ?? "./data/markup-workspace",
    ),
    lockDir: resolveFromRoot(
      process.env.SIGHTLOOP_LOCK_DIR ?? "./data/locks",
    ),
    markupAdapter,
    markupLicenseKey: process.env.MARKUP_LICENSE_KEY || undefined,
    dxBootstrap:
      process.env.SIGHTLOOP_DX_BOOTSTRAP === "1" ||
      process.env.SIGHTLOOP_DX_BOOTSTRAP === "true",
    dxLabel: process.env.SIGHTLOOP_DX_LABEL ?? "local",
    dualLoop:
      process.env.SIGHTLOOP_DUAL_LOOP === "1" ||
      process.env.SIGHTLOOP_DUAL_LOOP === "true",
    dualLoopMock:
      process.env.SIGHTLOOP_DUAL_LOOP_MOCK !== "0" &&
      process.env.SIGHTLOOP_DUAL_LOOP_MOCK !== "false",
    maxInnerRefines: Math.min(
      5,
      Math.max(
        0,
        Number.parseInt(process.env.SIGHTLOOP_MAX_INNER_REFINES ?? "2", 10) ||
          2,
      ),
    ),
    maxPlanAttempts: Math.min(
      4,
      Math.max(
        1,
        Number.parseInt(process.env.SIGHTLOOP_MAX_PLAN_ATTEMPTS ?? "2", 10) ||
          2,
      ),
    ),
    plannerModel:
      process.env.SIGHTLOOP_PLANNER_MODEL ??
      process.env.SIGHTLOOP_PLANNER_LLM_MODEL ??
      null,
    implementerModel:
      process.env.SIGHTLOOP_IMPLEMENTER_MODEL ??
      process.env.SIGHTLOOP_LLM_MODEL ??
      null,
    reviewerModel:
      process.env.SIGHTLOOP_REVIEWER_MODEL ??
      process.env.SIGHTLOOP_PLANNER_MODEL ??
      null,
    plannerKeyConfigured,
    reviewerKeyConfigured,
  };
}
