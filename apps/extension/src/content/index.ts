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
  if (message?.type === "session_awaiting_review") {
    toolbar.onAwaitingReview(String(message.sessionId ?? ""), message.preview ?? {});
  }
  if (message?.type === "session_terminal_event") {
    toolbar.onTerminal(
      String(message.sessionId ?? ""),
      String(message.status ?? ""),
    );
  }
  if (message?.type === "session_verify_event") {
    toolbar.onVerify(String(message.sessionId ?? ""), message.verify ?? {});
  }
  if (message?.type === "session_recall_event") {
    toolbar.onRecall(String(message.sessionId ?? ""), message.hits ?? []);
  }
  if (message?.type === "session_timeline_event") {
    toolbar.onTimelineEvent(String(message.sessionId ?? ""), message.event ?? {});
  }
  if (message?.type === "session_knowledge_distilled") {
    toolbar.onKnowledgeDistilled(
      String(message.sessionId ?? ""),
      message.knowledge ?? {},
    );
  }
  if (message?.type === "session_acceptance_gate") {
    toolbar.onAcceptanceGate(
      String(message.sessionId ?? ""),
      String(message.status ?? ""),
      message.report_summary ?? null,
    );
  }
});

window.addEventListener(
  "keydown",
  (ev) => {
    if (ev.altKey && ev.shiftKey && (ev.key === "A" || ev.key === "a")) {
      ev.preventDefault();
      toolbar.togglePick();
    }
  },
  true,
);
