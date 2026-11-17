import type { WebSocket } from "ws";
import type { SessionStatus, WsServerEvent } from "@sightloop/shared";

type Client = {
  socket: WebSocket;
  subscriptions: Set<string>;
};

/**
 * In-process fan-out for session status events (M2).
 * One hub per daemon process.
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
