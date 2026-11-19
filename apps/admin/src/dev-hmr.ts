/** How long a visible tab waits after the last heartbeat before reloading. */
export const HMR_STALE_MS = 7_000;
const CHECK_MS = 2_000;

/**
 * True when the Vite socket has gone quiet. A hidden tab is not expired:
 * browsers throttle its timers, and the next visit starts the window over.
 * `lastBeat <= 0` means we have not seen a heartbeat yet, so this server is
 * not advertising one (local `pnpm dev`) and must be left alone.
 */
export function hmrSocketExpired(lastBeat: number, now: number, visible: boolean): boolean {
  if (!visible || lastBeat <= 0) return false;
  return now - lastBeat > HMR_STALE_MS;
}

/**
 * Docker's published port can drop the Vite websocket and leave `readyState`
 * OPEN, so the client never sees a close and never reloads. Heartbeats are
 * the proof that frames are still arriving.
 */
export function watchHmrSocket(now: () => number = Date.now): void {
  if (!import.meta.hot) return;
  const g = globalThis as typeof globalThis & { __sightloopHmrWatch?: boolean };
  if (g.__sightloopHmrWatch) return;
  g.__sightloopHmrWatch = true;

  const hot = import.meta.hot;
  let lastBeat = 0;
  const mark = () => {
    lastBeat = now();
  };
  hot.on("sightloop:heartbeat", mark);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") mark();
  });
  window.setInterval(() => {
    if (!hmrSocketExpired(lastBeat, now(), document.visibilityState === "visible")) return;
    lastBeat = 0;
    location.reload();
  }, CHECK_MS);
}
