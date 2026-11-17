import { execFileSync, execSync } from "node:child_process";

export type GithubHealth = {
  gh_cli_present: boolean;
  authenticated: boolean;
  login: string | null;
  git_push_ready: boolean;
  heal_hint: string | null;
  checked_at: number;
};

const HEAL_HINT =
  "Reconnect GitHub in Cursor (Settings → GitHub / Connect), or run `gh auth login` on this machine. Cloud-agent short-lived tokens expire; App install alone is not enough for push.";

let cache: { at: number; value: GithubHealth } | null = null;
const TTL_MS = 30_000;

function whichGh(): boolean {
  try {
    execSync("command -v gh", { stdio: "ignore", shell: "/bin/bash" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort GitHub write-credential probe for DX / PR Accept heal UX.
 * Never returns tokens; never invents credentials.
 */
export function probeGithubHealth(force = false): GithubHealth {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) return cache.value;

  const gh_cli_present = whichGh();
  if (!gh_cli_present) {
    const value: GithubHealth = {
      gh_cli_present: false,
      authenticated: false,
      login: null,
      git_push_ready: false,
      heal_hint:
        "Install GitHub CLI (`gh`) and run `gh auth login`, or reconnect Cursor GitHub so deploy/PR Accept can push.",
      checked_at: now,
    };
    cache = { at: now, value };
    return value;
  }

  try {
    const login = execFileSync("gh", ["api", "user", "-q", ".login"], {
      encoding: "utf8",
      timeout: 8_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .slice(0, 80);
    if (!login) throw new Error("empty login");
    const value: GithubHealth = {
      gh_cli_present: true,
      authenticated: true,
      login,
      git_push_ready: true,
      heal_hint: null,
      checked_at: now,
    };
    cache = { at: now, value };
    return value;
  } catch {
    const value: GithubHealth = {
      gh_cli_present: true,
      authenticated: false,
      login: null,
      git_push_ready: false,
      heal_hint: HEAL_HINT,
      checked_at: now,
    };
    cache = { at: now, value };
    return value;
  }
}

export function deployHealHint(): string {
  return HEAL_HINT;
}
