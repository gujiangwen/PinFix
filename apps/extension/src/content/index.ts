import { SightLoopToolbar } from "./toolbar";

const toolbar = new SightLoopToolbar();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "toggle_pick") {
    toolbar.togglePick();
  }
  if (message?.type === "session_status_event") {
    toolbar.onSessionStatus(
      String(message.sessionId ?? ""),
      String(message.status ?? ""),
      Number(message.stepCount ?? 0),
    );
  }
});

// Hotkey fallback when commands API is unavailable on the page focus.
window.addEventListener(
  "keydown",
  (ev) => {
    if (ev.altKey && ev.shiftKey && (ev.key === "A" || ev.key === "a")) {
      // Prefer chrome.commands; this is a page-level backup.
      ev.preventDefault();
      toolbar.togglePick();
    }
  },
  true,
);
