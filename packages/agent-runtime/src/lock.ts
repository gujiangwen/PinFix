import {
  openSync,
  closeSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export type RepoLock = {
  release: () => void;
  lockPath: string;
};

function lockFilePath(lockDir: string, repoPath: string): string {
  const hash = createHash("sha256").update(resolve(repoPath)).digest("hex").slice(0, 24);
  return join(lockDir, `repo-${hash}.lock`);
}

/**
 * Simple exclusive file lock per repo_path.
 * Uses O_EXCL create; stale locks older than `staleMs` are stolen.
 */
export function acquireRepoLock(
  repoPath: string,
  opts: { lockDir: string; staleMs?: number; owner?: string } = {
    lockDir: "/tmp/sightloop-locks",
  },
): RepoLock {
  const staleMs = opts.staleMs ?? 30 * 60 * 1000;
  const lockDir = resolve(opts.lockDir);
  mkdirSync(lockDir, { recursive: true });
  const lockPath = lockFilePath(lockDir, repoPath);
  const payload = JSON.stringify({
    pid: process.pid,
    repoPath: resolve(repoPath),
    owner: opts.owner ?? "sightloop",
    at: Date.now(),
  });

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, payload);
      closeSync(fd);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      return false;
    }
  };

  if (!tryCreate()) {
    let steal = false;
    try {
      const raw = readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as { at?: number };
      if (typeof parsed.at === "number" && Date.now() - parsed.at > staleMs) {
        steal = true;
      }
    } catch {
      steal = true;
    }
    if (steal) {
      try {
        unlinkSync(lockPath);
      } catch {
        // race
      }
      if (!tryCreate()) {
        throw new Error(`repo_path lock held: ${resolve(repoPath)}`);
      }
    } else {
      throw new Error(`repo_path lock held: ${resolve(repoPath)}`);
    }
  }

  return {
    lockPath,
    release: () => {
      try {
        if (existsSync(lockPath)) unlinkSync(lockPath);
      } catch {
        // ignore
      }
    },
  };
}

export function ensureLockDirParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
