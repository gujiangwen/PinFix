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
