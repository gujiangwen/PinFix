import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findMonorepoRoot, resolveFromRoot } from "./paths.js";

export const LLM_SETTINGS_REL = "./data/llm-settings.env";

export type LlmRoleId = "planner" | "implementer" | "reviewer" | "judge";

export type LlmRolePublic = {
  provider: string | null;
  model: string | null;
  base_url: string | null;
  api_key_set: boolean;
  api_key_hint: string | null;
};

export type LlmSettingsPublic = {
  dual_loop_enabled: boolean;
  dual_loop_mock: boolean;
  cross_judge: boolean;
  roles: Record<LlmRoleId, LlmRolePublic>;
  settings_path: string;
  host_env_note: string;
};

export type LlmRolePatch = {
  provider?: string | null;
  model?: string | null;
  base_url?: string | null;
  /** Omit / empty = leave unchanged. Non-empty = set. */
  api_key?: string | null;
  clear_api_key?: boolean;
};

export type LlmSettingsPatch = {
  dual_loop_enabled?: boolean;
  dual_loop_mock?: boolean;
  cross_judge?: boolean;
  planner?: LlmRolePatch;
  implementer?: LlmRolePatch;
  reviewer?: LlmRolePatch;
  judge?: LlmRolePatch;
};

const ROLE_KEYS: Record<
  LlmRoleId,
  { provider?: string; model: string; key: string; base?: string }
> = {
  planner: {
    provider: "SIGHTLOOP_PLANNER_PROVIDER",
    model: "SIGHTLOOP_PLANNER_MODEL",
    key: "SIGHTLOOP_PLANNER_API_KEY",
    base: "SIGHTLOOP_PLANNER_BASE_URL",
  },
  implementer: {
    model: "SIGHTLOOP_IMPLEMENTER_MODEL",
    key: "SIGHTLOOP_IMPLEMENTER_API_KEY",
  },
  reviewer: {
    provider: "SIGHTLOOP_REVIEWER_PROVIDER",
    model: "SIGHTLOOP_REVIEWER_MODEL",
    key: "SIGHTLOOP_REVIEWER_API_KEY",
    base: "SIGHTLOOP_REVIEWER_BASE_URL",
  },
  judge: {
    model: "SIGHTLOOP_JUDGE_MODEL",
    key: "SIGHTLOOP_JUDGE_API_KEY",
  },
};

const MANAGED_KEYS = [
  "SIGHTLOOP_DUAL_LOOP",
  "SIGHTLOOP_DUAL_LOOP_MOCK",
  "SIGHTLOOP_CROSS_JUDGE",
  ...Object.values(ROLE_KEYS).flatMap((r) =>
    [r.provider, r.model, r.key, r.base].filter(Boolean) as string[],
  ),
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

function rolePublic(id: LlmRoleId): LlmRolePublic {
  const keys = ROLE_KEYS[id];
  const keyVal = process.env[keys.key];
  return {
    provider: keys.provider ? process.env[keys.provider]?.trim() || null : null,
    model: process.env[keys.model]?.trim() || null,
    base_url: keys.base ? process.env[keys.base]?.trim() || null : null,
    api_key_set: Boolean(keyVal?.trim()),
    api_key_hint: maskHint(keyVal),
  };
}

export function getLlmSettingsPublic(): LlmSettingsPublic {
  return {
    dual_loop_enabled: envFlag("SIGHTLOOP_DUAL_LOOP", false),
    dual_loop_mock: envFlag("SIGHTLOOP_DUAL_LOOP_MOCK", true),
    cross_judge: envFlag("SIGHTLOOP_CROSS_JUDGE", false),
    roles: {
      planner: rolePublic("planner"),
      implementer: rolePublic("implementer"),
      reviewer: rolePublic("reviewer"),
      judge: rolePublic("judge"),
    },
    settings_path: settingsPath(),
    host_env_note:
      "Keys are stored in data/llm-settings.env (volume) and applied to the running Daemon. They are never committed.",
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

function applyRolePatch(
  map: Map<string, string>,
  id: LlmRoleId,
  patch: LlmRolePatch | undefined,
): void {
  if (!patch) return;
  const keys = ROLE_KEYS[id];
  if (keys.provider && patch.provider !== undefined) {
    const v = patch.provider?.trim() || "";
    if (v) map.set(keys.provider, v);
    else map.delete(keys.provider);
  }
  if (patch.model !== undefined) {
    const v = patch.model?.trim() || "";
    if (v) map.set(keys.model, v);
    else map.delete(keys.model);
  }
  if (keys.base && patch.base_url !== undefined) {
    const v = patch.base_url?.trim() || "";
    if (v) map.set(keys.base, v);
    else map.delete(keys.base);
  }
  if (patch.clear_api_key) {
    map.delete(keys.key);
  } else if (typeof patch.api_key === "string" && patch.api_key.length > 0) {
    map.set(keys.key, patch.api_key);
  }
}

export function applyLlmSettingsPatch(patch: LlmSettingsPatch): LlmSettingsPublic {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? parseEnvFile(readFileSync(path, "utf8"))
    : new Map<string, string>();

  // Seed from process.env for managed keys not yet in file
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

  applyRolePatch(existing, "planner", patch.planner);
  applyRolePatch(existing, "implementer", patch.implementer);
  applyRolePatch(existing, "reviewer", patch.reviewer);
  applyRolePatch(existing, "judge", patch.judge);

  const lines = [
    "# SightLoop LLM settings — managed by Admin UI. Do not commit secrets.",
    `# Updated ${new Date().toISOString()}`,
    ...[...existing.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${escapeEnv(v)}`),
    "",
  ];
  writeFileSync(path, lines.join("\n"), "utf8");

  // Apply live to process.env
  for (const key of MANAGED_KEYS) {
    if (existing.has(key)) process.env[key] = existing.get(key)!;
    else delete process.env[key];
  }

  return getLlmSettingsPublic();
}

export function monorepoRoot(): string {
  return findMonorepoRoot();
}

export function resolveSettingsPath(): string {
  return resolve(settingsPath());
}
