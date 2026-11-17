import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { apiError } from "@sightloop/shared";

const PUBLIC_PATHS = new Set(["/health"]);

function extractToken(req: FastifyRequest): string | undefined {
  const h = req.headers;
  const sight =
    (h["x-sightloop-token"] as string | undefined) ??
    (h["x-pinfix-token"] as string | undefined);
  if (sight) return sight;

  const auth = h.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return undefined;
}

export function createAuthPlugin(expectedToken: string): FastifyPluginAsync {
  return async (app) => {
    app.addHook("onRequest", async (req, reply) => {
      const path = req.url.split("?")[0] ?? req.url;
      if (PUBLIC_PATHS.has(path)) return;

      // Defense in depth: only accept loopback peers for mutating/API routes.
      const ip = req.ip;
      if (ip !== "127.0.0.1" && ip !== "::1" && ip !== ":ffff:127.0.0.1") {
        return reply
          .code(403)
          .send(
            apiError(
              "forbidden_remote",
              "Daemon only accepts requests from loopback",
              { ip },
            ),
          );
      }

      const token = extractToken(req);
      if (!token || token !== expectedToken) {
        return reply
          .code(401)
          .send(
            apiError(
              "unauthorized",
              "Missing or invalid X-SightLoop-Token (alias: X-PinFix-Token)",
            ),
          );
      }
    });
  };
}

export type { FastifyReply };
