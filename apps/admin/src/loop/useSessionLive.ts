import { useCallback, useEffect, useRef, useState } from "react";
import type { WsServerEvent } from "@sightloop/shared";
import { api, wsUrl, type SessionDetail } from "../api";
import { nodeOfDualLoopEvent, type NodeId } from "./loop-model";

const REFETCH_DELAY_MS = 250;
/** Polling intervals for when there is no live socket. */
const POLL_RUNNING_MS = 1500;
const POLL_SETTLED_MS = 5000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

const RUNNING = new Set(["retrieving", "acting", "refined", "distilling"]);

/**
 * Refusals that retrying cannot fix. `forbidden_remote` is what a Daemon in
 * Docker answers: it sees the bridge address instead of loopback.
 */
const PERMANENT_REFUSALS = new Set(["unauthorized", "forbidden_remote"]);

export type SessionLive = {
  detail: SessionDetail | null;
  /** Unified diff of the session's change; null while unknown or unavailable. */
  patch: string | null;
  /** Node the Daemon last announced as entered and not yet left. */
  liveNode: NodeId | null;
  /** True while the WebSocket subscription is up; otherwise the hook polls. */
  connected: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Keeps one session's read model current. WebSocket events only say that
 * something changed; the read model is always refetched over REST, so a missed
 * or reordered event cannot leave the view wrong.
 */
export function useSessionLive(sessionId: string | null): SessionLive {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [liveNode, setLiveNode] = useState<NodeId | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentId = useRef(sessionId);
  const patchKey = useRef("");
  const running = useRef(false);
  currentId.current = sessionId;

  const refresh = useCallback(async () => {
    const id = currentId.current;
    if (!id) return;
    try {
      const next = await api.getSession(id);
      if (currentId.current !== id) return;
      setDetail(next);
      setError(null);
      running.current = RUNNING.has(next.session.status);

      const { git_base_sha, temp_commit_sha, status } = next.session;
      const key = `${id}:${git_base_sha}:${temp_commit_sha}:${status}`;
      if (key === patchKey.current) return;
      patchKey.current = key;
      try {
        const diff = await api.getDiff(id);
        if (currentId.current === id) setPatch(diff.patch);
      } catch {
        if (currentId.current === id) setPatch(null);
      }
    } catch (err) {
      if (currentId.current === id) setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    setDetail(null);
    setPatch(null);
    setLiveNode(null);
    setConnected(false);
    setError(null);
    patchKey.current = "";
    running.current = false;
    if (!sessionId) return;

    let disposed = false;
    let refused = false;
    let socket: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let refetchTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = RECONNECT_MIN_MS;

    const scheduleRefetch = () => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = undefined;
        void refresh();
      }, REFETCH_DELAY_MS);
    };

    const onEvent = (event: WsServerEvent) => {
      if (event.type === "subscribed") {
        retryDelay = RECONNECT_MIN_MS;
        setConnected(true);
        // Catch up on anything that happened while disconnected.
        scheduleRefetch();
        return;
      }
      if (event.type === "error") {
        if (PERMANENT_REFUSALS.has(event.code)) refused = true;
        return;
      }
      if (!("session_id" in event) || event.session_id !== sessionId) return;

      if (event.type === "session.dual_loop") {
        const node = nodeOfDualLoopEvent(event.node);
        if (event.status === "enter") setLiveNode(node);
        else setLiveNode((prev) => (prev === node ? null : prev));
      } else if (
        event.type === "session.terminal" ||
        event.type === "session.awaiting_review" ||
        (event.type === "session.status" && !RUNNING.has(event.status))
      ) {
        setLiveNode(null);
      }
      scheduleRefetch();
    };

    const connect = () => {
      if (disposed || refused) return;
      const ws = new WebSocket(wsUrl());
      socket = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ op: "subscribe", session_id: sessionId }));
      };
      ws.onmessage = (message) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(message.data));
        } catch {
          return;
        }
        // The loopback guard answers in the REST error shape, not as an event.
        const refusal = (parsed as { error?: { code?: unknown } }).error?.code;
        if (typeof refusal === "string") {
          if (PERMANENT_REFUSALS.has(refusal)) refused = true;
          return;
        }
        onEvent(parsed as WsServerEvent);
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        setConnected(false);
        if (disposed || refused) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
      };
    };

    void refresh();
    connect();

    // Without a live socket, poll while the tab is visible: quickly while the
    // loop is working, slowly once it has settled.
    const poll = () => {
      pollTimer = setTimeout(
        () => {
          const live = socket?.readyState === WebSocket.OPEN;
          if (!live && document.visibilityState === "visible") void refresh();
          poll();
        },
        running.current ? POLL_RUNNING_MS : POLL_SETTLED_MS,
      );
    };
    poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(refetchTimer);
      clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      const ws = socket;
      if (!ws) return;
      ws.onmessage = null;
      ws.onclose = null;
      // Closing a socket that is still connecting logs a browser warning.
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close();
    };
  }, [sessionId, refresh]);

  return { detail, patch, liveNode, connected, error, refresh };
}
