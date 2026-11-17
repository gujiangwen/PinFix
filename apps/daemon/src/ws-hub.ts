import type { WebSocket } from "ws";
import type {
  ProjectMode,
  SessionStatus,
  SessionStepEvent,
  WsServerEvent,
} from "@sightloop/shared";

type Client = {
  socket: WebSocket;
  subscriptions: Set<string>;
};

/**
 * In-process fan-out for session events.
 */
export class SessionWsHub {
  private clients = new Set<Client>();

  add(socket: WebSocket): Client {
    const client: Client = { socket, subscriptions: new Set() };
    this.clients.add(client);
    socket.on("close", () => {
      this.clients.delete(client);
    });
    return client;
  }

  subscribe(client: Client, sessionId: string): void {
    client.subscriptions.add(sessionId);
  }

  unsubscribe(client: Client, sessionId: string): void {
    client.subscriptions.delete(sessionId);
  }

  broadcastStatus(
    sessionId: string,
    status: SessionStatus,
    stepCount: number,
  ): void {
    const event: WsServerEvent = {
      type: "session.status",
      session_id: sessionId,
      status,
      step_count: stepCount,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastStep(sessionId: string, step: SessionStepEvent): void {
    const event: WsServerEvent = {
      type: "session.step",
      session_id: sessionId,
      step,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastAwaitingReview(
    sessionId: string,
    preview: {
      temp_commit_sha: string | null;
      summary: string;
      mode?: ProjectMode;
    },
  ): void {
    const event: WsServerEvent = {
      type: "session.awaiting_review",
      session_id: sessionId,
      preview,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastTerminal(sessionId: string, status: SessionStatus): void {
    const event: WsServerEvent = {
      type: "session.terminal",
      session_id: sessionId,
      status,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastVerify(
    sessionId: string,
    verify: {
      ok: boolean;
      exit_code?: number | null;
      log_tail: string;
      command?: string | null;
    },
  ): void {
    const event: WsServerEvent = {
      type: "session.verify",
      session_id: sessionId,
      verify,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastRecall(
    sessionId: string,
    hits: Array<{
      knowledge_id: string | null;
      title: string;
      score?: number | null;
      distance?: number | null;
      retrieve?: string | null;
      kind?: string | null;
      body_preview?: string;
    }>,
  ): void {
    const event: WsServerEvent = {
      type: "session.recall",
      session_id: sessionId,
      hits,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastTimeline(
    sessionId: string,
    eventPayload: {
      at: number;
      kind: string;
      label: string;
      detail?: string | null;
      note?: string;
    },
  ): void {
    const event: WsServerEvent = {
      type: "session.timeline",
      session_id: sessionId,
      event: eventPayload,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastKnowledgeDistilled(
    sessionId: string,
    knowledge: {
      id: string;
      title: string;
      kind: string;
      body_preview: string;
    },
  ): void {
    const event: WsServerEvent = {
      type: "session.knowledge_distilled",
      session_id: sessionId,
      knowledge,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastAcceptanceGate(
    sessionId: string,
    payload: {
      status:
        | "queued"
        | "running"
        | "passed"
        | "failed"
        | "error"
        | "cancelled";
      run_id?: string;
      progress?: {
        step_index: number;
        step_total: number;
        label: string;
      };
      report_summary?: {
        failed_checks?: string[];
        failed_steps?: Array<{ id: string; message: string }>;
        refine_note_draft?: string;
        artifact_preview?: Record<string, string>;
      };
    },
  ): void {
    const event: WsServerEvent = {
      type: "session.acceptance_gate",
      session_id: sessionId,
      ...payload,
    };
    this.sendToSession(sessionId, event);
  }

  broadcastSecurity(
    eventName: string,
    detail?: Record<string, unknown>,
  ): void {
    const event: WsServerEvent = {
      type: "security.alert",
      event: eventName,
      detail,
    };
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.socket.readyState === 1) {
        client.socket.send(payload);
      }
    }
  }

  sendToSession(sessionId: string, event: WsServerEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (!client.subscriptions.has(sessionId)) continue;
      if (client.socket.readyState === 1 /* OPEN */) {
        client.socket.send(payload);
      }
    }
  }

  send(client: Client, event: WsServerEvent): void {
    if (client.socket.readyState === 1) {
      client.socket.send(JSON.stringify(event));
    }
  }
}
