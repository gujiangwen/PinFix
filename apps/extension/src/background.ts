import type {
  ExtensionSettings,
  RuntimeMessage,
  RuntimeResponse,
} from "./shared/protocol";
import { DAEMON_PORT_CANDIDATES, DEFAULT_SETTINGS } from "./shared/protocol";

const SESSION_STATUS = new Map<string, { status: string; step_count: number }>();
let ws: WebSocket | null = null;
let wsSettings: ExtensionSettings | null = null;

async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(["settings"]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.settings as Partial<ExtensionSettings> | undefined),
  };
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

function broadcastToTabs(payload: Record<string, unknown>): void {
  void chrome.runtime.sendMessage(payload).catch(() => {
    /* no receivers in extension pages */
  });
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      void chrome.tabs.sendMessage(tab.id, payload).catch(() => {
        /* content script may be absent */
      });
    }
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
        preview?: {
          temp_commit_sha?: string | null;
          summary?: string;
          mode?: string;
        };
        step?: unknown;
      };
      if (msg.type === "session.status" && msg.session_id) {
        SESSION_STATUS.set(msg.session_id, {
          status: msg.status ?? "idle",
          step_count: msg.step_count ?? 0,
        });
        broadcastToTabs({
          type: "session_status_event",
          sessionId: msg.session_id,
          status: msg.status,
          stepCount: msg.step_count,
        });
      }
      if (msg.type === "session.awaiting_review" && msg.session_id) {
        SESSION_STATUS.set(msg.session_id, {
          status: "awaiting_review",
          step_count:
            SESSION_STATUS.get(msg.session_id)?.step_count ?? 0,
        });
        broadcastToTabs({
          type: "session_awaiting_review",
          sessionId: msg.session_id,
          preview: msg.preview ?? {},
        });
      }
      if (msg.type === "session.step" && msg.session_id) {
        broadcastToTabs({
          type: "session_step_event",
          sessionId: msg.session_id,
          step: msg.step,
        });
      }
      if (msg.type === "session.terminal" && msg.session_id) {
        SESSION_STATUS.set(msg.session_id, {
          status: msg.status ?? "accepted",
          step_count:
            SESSION_STATUS.get(msg.session_id)?.step_count ?? 0,
        });
        broadcastToTabs({
          type: "session_terminal_event",
          sessionId: msg.session_id,
          status: msg.status,
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

async function startSession(
  settings: ExtensionSettings,
  sessionId: string,
): Promise<unknown> {
  const res = await daemonFetch(settings, `/v1/sessions/${sessionId}/start`, {
    method: "POST",
    body: "{}",
  });
  const json = (await res.json()) as {
    session?: { id: string };
    error?: { message: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

async function createSession(
  settings: ExtensionSettings,
  pageUrl: string,
  sniff: unknown,
  annotation?: { note?: string; selector?: string },
  start?: boolean,
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
  const json = (await res.json()) as {
    session?: { id: string };
    error?: { message: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  const sessionId = json.session?.id;
  if (sessionId) {
    wsSend(settings, { op: "subscribe", session_id: sessionId });
    const shouldStart = start ?? settings.autoStart !== false;
    if (shouldStart) {
      const started = (await startSession(settings, sessionId)) as {
        session?: unknown;
      };
      return { ...json, started: started.session ?? started };
    }
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
    case "discover_daemon": {
      const settings = await loadSettings();
      const tried: string[] = [];
      const bases = [
        settings.daemonUrl.replace(/\/$/, ""),
        ...DAEMON_PORT_CANDIDATES.map((p) => `http://127.0.0.1:${p}`),
      ];
      const unique = [...new Set(bases)];
      for (const base of unique) {
        tried.push(base);
        try {
          const res = await fetch(`${base}/health`, {
            signal: AbortSignal.timeout(1500),
          });
          if (!res.ok) continue;
          const health = (await res.json()) as {
            ok?: boolean;
            version?: string;
            service?: string;
          };
          if (!health.ok) continue;
          let dx: unknown = null;
          try {
            const dxRes = await fetch(`${base}/v1/dx/status`, {
              signal: AbortSignal.timeout(1500),
            });
            if (dxRes.ok) dx = await dxRes.json();
          } catch {
            // status optional during discover
          }
          return {
            ok: true,
            data: {
              daemonUrl: base,
              health,
              dx,
              tried,
            },
          };
        } catch {
          // try next
        }
      }
      return {
        ok: false,
        error: `未探测到 Daemon。请先运行：pnpm dev:daemon（已试 ${tried.join(", ")}）`,
      };
    }
    case "dx_status": {
      const settings = await loadSettings();
      const res = await fetch(
        `${settings.daemonUrl.replace(/\/$/, "")}/v1/dx/status`,
        { signal: AbortSignal.timeout(2000) },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            `HTTP ${res.status}`,
        );
      }
      return { ok: true, data: json };
    }
    case "dx_bootstrap": {
      const settings = await loadSettings();
      const res = await fetch(
        `${settings.daemonUrl.replace(/\/$/, "")}/v1/dx/bootstrap`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            `HTTP ${res.status}`,
        );
      }
      const token = (json as { token?: string | null }).token;
      if (token) {
        await saveSettings({ ...settings, token });
      }
      return { ok: true, data: json };
    }
    case "dx_ensure_fixture": {
      const settings = await loadSettings();
      const res = await daemonFetch(
        settings,
        "/v1/dx/ensure-fixture-project",
        { method: "POST", body: "{}" },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            `HTTP ${res.status}`,
        );
      }
      const projectId =
        (json as { project_id?: string }).project_id ??
        settings.projectId;
      await saveSettings({
        ...settings,
        projectId,
        dxOnboardedAt: new Date().toISOString(),
      });
      return { ok: true, data: json };
    }
    case "dx_bind_repo": {
      const settings = await loadSettings();
      const res = await daemonFetch(settings, "/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: message.name ?? "local-repo",
          repo_path: message.repo_path,
          origin_pattern:
            message.origin_pattern ?? "http://localhost:*/*",
          file_whitelist: ["src/**", "AGENTS.md"],
          mode: message.mode ?? "hmr",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            `HTTP ${res.status}`,
        );
      }
      const project = (json as { project?: { id: string } }).project;
      if (project?.id) {
        await saveSettings({ ...settings, projectId: project.id });
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
        message.start,
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
          true,
        );
        sessions.push(data);
      }
      return { ok: true, data: { sessions } };
    }
    case "start_session": {
      const settings = await loadSettings();
      wsSend(settings, { op: "subscribe", session_id: message.sessionId });
      const data = await startSession(settings, message.sessionId);
      return { ok: true, data };
    }
    case "review_session": {
      const settings = await loadSettings();
      const res = await daemonFetch(
        settings,
        `/v1/sessions/${message.sessionId}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            decision: message.decision,
            ...(message.note ? { note: message.note } : {}),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            `HTTP ${res.status}`,
        );
      }
      return { ok: true, data: json };
    }
    case "get_diff": {
      const settings = await loadSettings();
      const res = await daemonFetch(
        settings,
        `/v1/sessions/${message.sessionId}/diff`,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            `HTTP ${res.status}`,
        );
      }
      return { ok: true, data: json };
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
  if (tab.id == null) return;
  void chrome.tabs.sendMessage(tab.id, { type: "toggle_pick" }).catch(() => {});
});
