export type SettingsSection =
  | "pi"
  | "projects"
  | "extension"
  | "appearance"
  | "audit"
  | "metrics";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  "pi",
  "projects",
  "extension",
  "appearance",
  "audit",
  "metrics",
];

export type Page =
  | { name: "loop"; sessionId: string | null }
  | { name: "knowledge"; cardId: string | null };

export type ParsedRoute =
  | { kind: "page"; page: Page }
  | { kind: "settings"; section: SettingsSection }
  | { kind: "redirect"; to: string };

export const HOME_HASH = "#/";

/** Pre-refactor tab hashes (`#models`, …) that docs and bookmarks still use. */
const LEGACY_HASHES: Record<string, string> = {
  sessions: HOME_HASH,
  knowledge: "#/knowledge",
  models: "#/settings/pi",
  projects: "#/settings/projects",
  extension: "#/settings/extension",
  audit: "#/settings/audit",
  metrics: "#/settings/metrics",
};

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseHash(hash: string): ParsedRoute {
  const raw = hash.replace(/^#/, "");
  if (raw === "" || raw === "/") {
    return { kind: "page", page: { name: "loop", sessionId: null } };
  }
  if (!raw.startsWith("/")) {
    return { kind: "redirect", to: LEGACY_HASHES[raw] ?? HOME_HASH };
  }

  const segments = raw.slice(1).split("/").filter(Boolean).map(decodeSegment);
  if (segments.some((s) => s === null)) {
    return { kind: "redirect", to: HOME_HASH };
  }
  const [head, arg, ...rest] = segments as string[];
  if (rest.length > 0) return { kind: "redirect", to: HOME_HASH };

  if (head === "s" && arg) {
    return { kind: "page", page: { name: "loop", sessionId: arg } };
  }
  if (head === "knowledge") {
    return { kind: "page", page: { name: "knowledge", cardId: arg ?? null } };
  }
  if (head === "settings") {
    const section = SETTINGS_SECTIONS.find((s) => s === arg);
    return section
      ? { kind: "settings", section }
      : { kind: "redirect", to: settingsHash("pi") };
  }
  return { kind: "redirect", to: HOME_HASH };
}

export function pageHash(page: Page): string {
  if (page.name === "knowledge") {
    return page.cardId
      ? `#/knowledge/${encodeURIComponent(page.cardId)}`
      : "#/knowledge";
  }
  return page.sessionId
    ? `#/s/${encodeURIComponent(page.sessionId)}`
    : HOME_HASH;
}

export function settingsHash(section: SettingsSection): string {
  return `#/settings/${section}`;
}
