import type {
  ExtensionSettings,
  RuntimeMessage,
  RuntimeResponse,
} from "./shared/protocol";
import { DEFAULT_SETTINGS } from "./shared/protocol";

const SESSION_STATUS = new Map<string, { status: string; step_count: number }>();
let ws: WebSocket | null = null;
let wsSettings: ExtensionSettings | null = null;

async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(["settings"]);
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<ExtensionSettings> | undefined) };
}

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
  wsSettings = settings;
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-SightLoop-Token": token,
  };
}

async function daemonFetch(
  settings: ExtensionSettings,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${settings.daemonUrl.replace(/\/$/, "")}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...authHeaders(settings.token),
      ...(init?.headers ?? {}),
    },
  });
}

function ensureWs(settings: ExtensionSettings): WebSocket {
  if (
    ws &&
    ws.readyState <= WebSocket.OPEN &&
    wsSettings?.daemonUrl === settings.daemonUrl &&
    wsSettings?.token === settings.token
  ) {
    return ws;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  wsSettings = settings;
  const base = settings.daemonUrl.replace(/^http/, "ws").replace(/\/$/, "");
  const url = `${base}/v1/ws?token=${encodeURIComponent(settings.token)}`;
  ws = new WebSocket(url);
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        type?: string;
        session_id?: string;
        status?: string;
        step_count?: number;
      };
      if (msg.type === "session.status" && msg.session_id) {
        SESSION_STATUS.set(msg.session_id, {
          status: msg.status ?? "idle",
          step_count: msg.step_count ?? 0,
        });
        void chrome.runtime
          .sendMessage({
            type: "session_status_event",
            sessionId: msg.session_id,
            status: msg.status,
            stepCount: msg.step_count,
          })
          .catch(() => {
            /* no receivers */
          });
      }
    } catch {
      // ignore malformed
    }
  });
  ws.addEventListener("close", () => {
    if (ws?.readyState === WebSocket.CLOSED) ws = null;
  });
  return ws;
}

function wsSend(settings: ExtensionSettings, payload: unknown): void {
  const socket = ensureWs(settings);
  const body = JSON.stringify(payload);
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(body);
  } else {
    socket.addEventListener(
      "open",
      () => {
        socket.send(body);
      },
      { once: true },
    );
  }
}

async function createSession(
  settings: ExtensionSettings,
  pageUrl: string,
  sniff: unknown,
  annotation?: { note?: string; selector?: string },
): Promise<unknown> {
  if (!settings.projectId) {
    throw new Error("Select a project in the SightLoop popup first");
  }
  const res = await daemonFetch(settings, "/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      project_id: settings.projectId,
      page_url: pageUrl,
      sniff,
      ...(annotation ? { annotation } : {}),
    }),
  });
  const json = (await res.json()) as { session?: { id: string }; error?: { message: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  const sessionId = json.session?.id;
  if (sessionId) {
    wsSend(settings, { op: "subscribe", session_id: sessionId });
  }
  return json;
}

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
    void (async () => {
      try {
        const reply = await handleMessage(message);
        sendResponse(reply);
      } catch (err) {
        sendResponse({
          ok: false,
          error: (err as Error).message ?? String(err),
        } satisfies RuntimeResponse);
      }
    })();
    return true;
  },
);

async function handleMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  switch (message.type) {
    case "get_settings": {
      return { ok: true, data: await loadSettings() };
    }
    case "save_settings": {
      await saveSettings(message.settings);
      return { ok: true };
    }
    case "list_projects": {
      const settings = await loadSettings();
      const res = await daemonFetch(settings, "/v1/projects");
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            `HTTP ${res.status}`,
        );
      }
      return { ok: true, data: json };
    }
    case "create_session": {
      const settings = await loadSettings();
      const data = await createSession(
        settings,
        message.pageUrl,
        message.sniff,
        message.annotation,
      );
      return { ok: true, data };
    }
    case "create_sessions_batch": {
      const settings = await loadSettings();
      const sessions = [];
      for (const item of message.items) {
        const data = await createSession(
          settings,
          message.pageUrl,
          item.sniff,
          item.annotation,
        );
        sessions.push(data);
      }
      return { ok: true, data: { sessions } };
    }
    case "subscribe_session": {
      const settings = await loadSettings();
      wsSend(settings, { op: "subscribe", session_id: message.sessionId });
      return {
        ok: true,
        data: SESSION_STATUS.get(message.sessionId) ?? null,
      };
    }
    case "toggle_pick": {
      // Forwarded from command; content scripts listen.
      return { ok: true };
    }
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-pick") return;
  void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId == null) return;
    void chrome.tabs.sendMessage(tabId, { type: "toggle_pick" }).catch(() => {
      /* content script may be absent */
    });
  });
});

chrome.action.onClicked.addListener((tab) => {
  // Popup is default; this fires only if popup is absent.
  if (tab.id == null) return;
  void chrome.tabs.sendMessage(tab.id, { type: "toggle_pick" }).catch(() => {});
});
