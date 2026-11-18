import type { Session } from "@sightloop/shared";

export function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

/** Compact duration: 850ms, 12.4s, 3m 05s. */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** What the session is about: the reporter's note if there is one, else the page. */
export function sessionTitle(
  session: Pick<Session, "annotation" | "page_url">,
): string {
  const note = session.annotation?.note?.trim().split(/\r?\n/)[0];
  if (note) return note.length > 90 ? `${note.slice(0, 90)}…` : note;
  try {
    const url = new URL(session.page_url);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return session.page_url;
  }
}
