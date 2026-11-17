import type { FastifyPluginAsync } from "fastify";
import websocket from "@fastify/websocket";
import {
  WsClientMessageSchema,
  apiError,
  type WsServerEvent,
} from "@sightloop/shared";
import { getSession, type Database } from "@sightloop/db";
import type { SessionWsHub } from "../ws-hub.js";

export type WsRouteOpts = {
  db: Database;
  hub: SessionWsHub;
  token: string;
};

function extractWsToken(url: string, headers: Record<string, unknown>): string | undefined {
  try {
    const u = new URL(url, "http://127.0.0.1");
    const q =
      u.searchParams.get("token") ??
      u.searchParams.get("access_token") ??
      undefined;
    if (q) return q;
  } catch {
    // ignore
  }
  const h = headers;
  const sight =
    (h["x-sightloop-token"] as string | undefined) ??
    (h["x-pinfix-token"] as string | undefined);
  if (sight) return sight;
  const auth = h.authorization as string | undefined;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return undefined;
}

export const wsRoutes: FastifyPluginAsync<WsRouteOpts> = async (app, opts) => {
  const { db, hub, token } = opts;

  await app.register(websocket);

  app.get("/v1/ws", { websocket: true }, (socket, req) => {
    const peer = req.ip;
    if (peer !== "127.0.0.1" && peer !== "::1" && peer !== ":ffff:127.0.0.1") {
      socket.send(
        JSON.stringify(
          apiError("forbidden_remote", "Daemon only accepts loopback WS", {
            ip: peer,
          }),
        ),
      );
      socket.close();
      return;
    }

    const provided = extractWsToken(req.url, req.headers as Record<string, unknown>);
    if (!provided || provided !== token) {
      const err: WsServerEvent = {
        type: "error",
        code: "unauthorized",
        message: "Missing or invalid token (query ?token= or header)",
      };
      socket.send(JSON.stringify(err));
      socket.close();
      return;
    }

    const client = hub.add(socket);

    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        hub.send(client, {
          type: "error",
          code: "invalid_json",
          message: "WS message must be JSON",
        });
        return;
      }

      const msg = WsClientMessageSchema.safeParse(parsed);
      if (!msg.success) {
        hub.send(client, {
          type: "error",
          code: "validation_error",
          message: "Invalid WS message",
        });
        return;
      }

      if (msg.data.op === "ping") {
        hub.send(client, { type: "pong" });
        return;
      }

      if (msg.data.op === "subscribe") {
        const session = getSession(db, msg.data.session_id);
        if (!session) {
          hub.send(client, {
            type: "error",
            code: "not_found",
            message: `Session ${msg.data.session_id} not found`,
          });
          return;
        }
        hub.subscribe(client, session.id);
        hub.send(client, { type: "subscribed", session_id: session.id });
        hub.send(client, {
          type: "session.status",
          session_id: session.id,
          status: session.status,
          step_count: session.step_count,
        });
        return;
      }

      if (msg.data.op === "unsubscribe") {
        hub.unsubscribe(client, msg.data.session_id);
      }
    });
  });
};
