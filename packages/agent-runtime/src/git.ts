import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function git(repoPath: string, args: string[], opts?: { allowFail?: boolean }): string {
  try {
    return execFileSync("git", args, {
      cwd: resolve(repoPath),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (opts?.allowFail) return "";
    throw err;
  }
}

export function ensureGitRepo(repoPath: string): void {
  const dir = resolve(repoPath);
  if (!existsSync(join(dir, ".git"))) {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    git(dir, ["config", "user.email", "sightloop@localhost"]);
    git(dir, ["config", "user.name", "SightLoop"]);
    // Ensure at least one commit so reset/diff have a base.
    execSync("git add -A && git commit --allow-empty -m \"sightloop: init\"", {
      cwd: dir,
      stdio: "ignore",
    });
  }
}

export function getHeadSha(repoPath: string): string {
  ensureGitRepo(repoPath);
  return git(repoPath, ["rev-parse", "HEAD"]);
}

export function createTempCommit(
  repoPath: string,
  message: string,
): string | null {
  ensureGitRepo(repoPath);
  git(repoPath, ["add", "-A"]);
  const status = git(repoPath, ["status", "--porcelain"]);
  if (!status) {
    // Nothing to commit — still return HEAD as temp marker when dirty was expected.
    return getHeadSha(repoPath);
  }
  // Prefer non-interactive commit without hooks surprises.
  try {
    execFileSync(
      "git",
      ["commit", "-m", message, "--no-gpg-sign"],
      {
        cwd: resolve(repoPath),
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "SightLoop",
          GIT_AUTHOR_EMAIL: "sightloop@localhost",
          GIT_COMMITTER_NAME: "SightLoop",
          GIT_COMMITTER_EMAIL: "sightloop@localhost",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/nothing to commit/i.test(msg)) return getHeadSha(repoPath);
    throw err;
  }
  return getHeadSha(repoPath);
}

export function resetHard(repoPath: string, sha: string): void {
  git(repoPath, ["reset", "--hard", sha]);
}

export function diffPatch(
  repoPath: string,
  baseSha: string | null,
  headSha?: string | null,
): string {
  ensureGitRepo(repoPath);
  if (!baseSha) {
    return git(repoPath, ["diff", "--no-ext-diff"], { allowFail: true });
  }
  if (headSha) {
    return git(repoPath, ["diff", "--no-ext-diff", baseSha, headSha], {
      allowFail: true,
    });
  }
  return git(repoPath, ["diff", "--no-ext-diff", baseSha], { allowFail: true });
}

export function runVerifyCmd(
  repoPath: string,
  cmd: string,
  timeoutMs = 60_000,
): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd: resolve(repoPath),
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      shell: "/bin/bash",
    });
    return { ok: true, output: String(output).slice(0, 8000) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`.slice(
      0,
      8000,
    );
    return { ok: false, output };
  }
}

/**
 * Best-effort `gh pr create` for PR mode Accept.
 * Returns PR URL or error string; never throws.
 */
export function tryCreatePr(
  repoPath: string,
  opts: { title: string; body: string; base?: string; head?: string },
): { ok: boolean; detail: string } {
  try {
    const args = [
      "pr",
      "create",
      "--title",
      opts.title,
      "--body",
      opts.body,
      ...(opts.base ? ["--base", opts.base] : []),
      ...(opts.head ? ["--head", opts.head] : []),
    ];
    const out = execFileSync("gh", args, {
      cwd: resolve(repoPath),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, detail: out };
  } catch (err) {
    return {
      ok: false,
      detail: (err as Error).message?.slice(0, 2000) ?? "gh pr create failed",
    };
  }
}
