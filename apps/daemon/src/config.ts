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

  return {
    host,
    port: Number.parseInt(process.env.SIGHTLOOP_PORT ?? "7420", 10),
    token: required("SIGHTLOOP_TOKEN", "dev-token-change-me"),
    allowedRoots: parseRoots(),
    dbPath: resolveFromRoot(
      process.env.SIGHTLOOP_DB_PATH ?? "./data/projects.sqlite",
    ),
    version: "0.4.0",
    markupWorkspaceRoot: resolveFromRoot(
      process.env.MARKUP_WORKSPACE ?? "./data/markup-workspace",
    ),
    lockDir: resolveFromRoot(
      process.env.SIGHTLOOP_LOCK_DIR ?? "./data/locks",
    ),
    markupAdapter,
    markupLicenseKey: process.env.MARKUP_LICENSE_KEY || undefined,
  };
}
