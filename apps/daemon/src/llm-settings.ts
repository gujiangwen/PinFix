import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolvePiConnection } from "@sightloop/agent-runtime";
import { resolveFromRoot } from "./paths.js";

export const LLM_SETTINGS_REL = "./data/llm-settings.env";

export type LlmRoleId = "planner" | "implementer" | "reviewer" | "judge";

export type PiConnectionPublic = {
  provider: string | null;
  base_url: string | null;
  default_model: string | null;
  api_key_set: boolean;
  api_key_hint: string | null;
};

export type LlmSettingsPublic = {
  dual_loop_enabled: boolean;
  dual_loop_mock: boolean;
  cross_judge: boolean;
  /** Shared Pi credential (one key for all roles). */
  pi: PiConnectionPublic;
  /** Per-role model picks only. */
  role_models: Record<LlmRoleId, string | null>;
  settings_path: string;
  host_env_note: string;
};

export type LlmSettingsPatch = {
  dual_loop_enabled?: boolean;
  dual_loop_mock?: boolean;
  cross_judge?: boolean;
  pi?: {
    provider?: string | null;
    base_url?: string | null;
    default_model?: string | null;
    api_key?: string | null;
    clear_api_key?: boolean;
  };
  role_models?: Partial<Record<LlmRoleId, string | null>>;
};

const ROLE_MODEL_KEYS: Record<LlmRoleId, string> = {
  planner: "SIGHTLOOP_PLANNER_MODEL",
  implementer: "SIGHTLOOP_IMPLEMENTER_MODEL",
  reviewer: "SIGHTLOOP_REVIEWER_MODEL",
  judge: "SIGHTLOOP_JUDGE_MODEL",
};

const MANAGED_KEYS = [
  "SIGHTLOOP_DUAL_LOOP",
  "SIGHTLOOP_DUAL_LOOP_MOCK",
  "SIGHTLOOP_CROSS_JUDGE",
  "PI_API_KEY",
  "SIGHTLOOP_LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SIGHTLOOP_PI_PROVIDER",
  "SIGHTLOOP_LLM_PROVIDER",
  "SIGHTLOOP_PI_BASE_URL",
  "SIGHTLOOP_LLM_BASE_URL",
  "SIGHTLOOP_LLM_MODEL",
  "SIGHTLOOP_PI_MODEL",
  ...Object.values(ROLE_MODEL_KEYS),
];

function settingsPath(): string {
  return resolveFromRoot(LLM_SETTINGS_REL);
}

export function loadLlmSettingsFileIntoEnv(): string {
  const path = settingsPath();
  if (!existsSync(path)) return path;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
  return path;
}

function maskHint(value: string | undefined | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.length <= 4) return "••••";
  return `…${v.slice(-4)}`;
}

function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export function getLlmSettingsPublic(): LlmSettingsPublic {
  const pi = resolvePiConnection(process.env);
  return {
    dual_loop_enabled: envFlag("SIGHTLOOP_DUAL_LOOP", false),
    dual_loop_mock: envFlag("SIGHTLOOP_DUAL_LOOP_MOCK", true),
    cross_judge: envFlag("SIGHTLOOP_CROSS_JUDGE", false),
    pi: {
      provider: pi.provider,
      base_url: pi.baseUrl,
      default_model: pi.defaultModel,
      api_key_set: pi.keyConfigured,
      api_key_hint: maskHint(pi.apiKey),
    },
    role_models: {
      planner: process.env.SIGHTLOOP_PLANNER_MODEL?.trim() || null,
      implementer: process.env.SIGHTLOOP_IMPLEMENTER_MODEL?.trim() || null,
      reviewer: process.env.SIGHTLOOP_REVIEWER_MODEL?.trim() || null,
      judge: process.env.SIGHTLOOP_JUDGE_MODEL?.trim() || null,
    },
    settings_path: settingsPath(),
    host_env_note:
      "Pi-centric: one shared credential (PI_API_KEY / OPENAI_API_KEY / …). Roles only store model names in data/llm-settings.env.",
  };
}

function parseEnvFile(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map.set(key, val);
  }
  return map;
}

function escapeEnv(value: string): string {
  if (/[\s#"']/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Canonical shared key slot written by Admin. */
const PRIMARY_KEY = "SIGHTLOOP_LLM_API_KEY";

export function applyLlmSettingsPatch(patch: LlmSettingsPatch): LlmSettingsPublic {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? parseEnvFile(readFileSync(path, "utf8"))
    : new Map<string, string>();

  for (const key of MANAGED_KEYS) {
    if (!existing.has(key) && process.env[key]) {
      existing.set(key, process.env[key]!);
    }
  }

  if (patch.dual_loop_enabled !== undefined) {
    existing.set("SIGHTLOOP_DUAL_LOOP", patch.dual_loop_enabled ? "1" : "0");
  }
  if (patch.dual_loop_mock !== undefined) {
    existing.set("SIGHTLOOP_DUAL_LOOP_MOCK", patch.dual_loop_mock ? "1" : "0");
  }
  if (patch.cross_judge !== undefined) {
    existing.set("SIGHTLOOP_CROSS_JUDGE", patch.cross_judge ? "1" : "0");
  }

  if (patch.pi) {
    const p = patch.pi;
    if (p.provider !== undefined) {
      const v = p.provider?.trim() || "";
      if (v) existing.set("SIGHTLOOP_PI_PROVIDER", v);
      else existing.delete("SIGHTLOOP_PI_PROVIDER");
    }
    if (p.base_url !== undefined) {
      const v = p.base_url?.trim() || "";
      if (v) existing.set("SIGHTLOOP_PI_BASE_URL", v);
      else existing.delete("SIGHTLOOP_PI_BASE_URL");
    }
    if (p.default_model !== undefined) {
      const v = p.default_model?.trim() || "";
      if (v) existing.set("SIGHTLOOP_LLM_MODEL", v);
      else existing.delete("SIGHTLOOP_LLM_MODEL");
    }
    if (p.clear_api_key) {
      existing.delete(PRIMARY_KEY);
      existing.delete("PI_API_KEY");
      existing.delete("OPENAI_API_KEY");
      existing.delete("ANTHROPIC_API_KEY");
    } else if (typeof p.api_key === "string" && p.api_key.length > 0) {
      existing.set(PRIMARY_KEY, p.api_key);
      // Keep a single source of truth in the managed file.
      existing.delete("PI_API_KEY");
      existing.delete("OPENAI_API_KEY");
      existing.delete("ANTHROPIC_API_KEY");
    }
  }

  if (patch.role_models) {
    for (const role of Object.keys(ROLE_MODEL_KEYS) as LlmRoleId[]) {
      if (!(role in patch.role_models)) continue;
      const v = patch.role_models[role]?.trim() || "";
      const key = ROLE_MODEL_KEYS[role];
      if (v) existing.set(key, v);
      else existing.delete(key);
    }
  }

  // Drop legacy per-role API keys from the managed file (models stay).
  for (const legacy of [
    "SIGHTLOOP_PLANNER_API_KEY",
    "SIGHTLOOP_REVIEWER_API_KEY",
    "SIGHTLOOP_IMPLEMENTER_API_KEY",
    "SIGHTLOOP_JUDGE_API_KEY",
    "SIGHTLOOP_PLANNER_PROVIDER",
    "SIGHTLOOP_REVIEWER_PROVIDER",
    "SIGHTLOOP_PLANNER_BASE_URL",
    "SIGHTLOOP_REVIEWER_BASE_URL",
  ]) {
    existing.delete(legacy);
  }

  const lines = [
    "# SightLoop Pi LLM settings — managed by Admin. Do not commit secrets.",
    `# Updated ${new Date().toISOString()}`,
    ...[...existing.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${escapeEnv(v)}`),
    "",
  ];
  writeFileSync(path, lines.join("\n"), "utf8");

  for (const key of MANAGED_KEYS) {
    if (existing.has(key)) process.env[key] = existing.get(key)!;
    else delete process.env[key];
  }
  for (const legacy of [
    "SIGHTLOOP_PLANNER_API_KEY",
    "SIGHTLOOP_REVIEWER_API_KEY",
    "SIGHTLOOP_IMPLEMENTER_API_KEY",
    "SIGHTLOOP_JUDGE_API_KEY",
  ]) {
    delete process.env[legacy];
  }

  return getLlmSettingsPublic();
}

export function resolveSettingsPath(): string {
  return resolve(settingsPath());
}
