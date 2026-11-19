import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const polling =
  process.env.CHOKIDAR_USEPOLLING === "1" ||
  process.env.CHOKIDAR_USEPOLLING === "true";
const hmrClientPort = Number(process.env.SIGHTLOOP_HMR_CLIENT_PORT);
// Docker publishes the dev server on 127.0.0.1, not on the container port and
// not on ::1. `localhost` often resolves to IPv6, so the browser socket must
// be pinned to that same IPv4 address.
const hmrClientHost = process.env.SIGHTLOOP_HMR_CLIENT_HOST || "127.0.0.1";
const hmrOverPublish = Number.isFinite(hmrClientPort) && hmrClientPort > 0;

// Inside the client's 7s stale window: one late frame does not reload the page.
const HMR_HEARTBEAT_MS = 2_000;

export default defineConfig({
  plugins: [react(), publishedPortHmr()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    watch: polling
      ? {
          usePolling: true,
          interval: 300,
          // The Windows bind mount can report a new mtime before the bytes
          // are readable. Wait until the size stops changing, then read.
          awaitWriteFinish: {
            stabilityThreshold: 200,
            pollInterval: 100,
          },
        }
      : undefined,
    hmr: hmrOverPublish
      ? {
          protocol: "ws",
          host: hmrClientHost,
          clientPort: hmrClientPort,
        }
      : undefined,
  },
});

function publishedPortHmr(): Plugin {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cssReload: ReturnType<typeof setTimeout> | undefined;

  return {
    name: "sightloop-published-port-hmr",
    apply: "serve",
    configureServer(server) {
      if (!hmrOverPublish) return;
      if (heartbeat) clearInterval(heartbeat);
      const send = () => {
        server.ws.send({
          type: "custom",
          event: "sightloop:heartbeat",
          data: { t: Date.now() },
        });
      };
      send();
      const timer = setInterval(send, HMR_HEARTBEAT_MS);
      heartbeat = timer;
      server.httpServer?.on("close", () => {
        if (heartbeat === timer) {
          clearInterval(timer);
          heartbeat = undefined;
        }
      });
    },
    handleHotUpdate(ctx) {
      // A CSS module patch is easy to miss: the socket can swallow the frame,
      // or the mount can still be serving the previous bytes. A reload fetches
      // the stylesheet again. Component files keep React Fast Refresh.
      if (!hmrOverPublish || !ctx.file.endsWith(".css")) return;
      if (ctx.file.includes("node_modules")) return;
      if (cssReload) clearTimeout(cssReload);
      const server = ctx.server;
      const file = ctx.file;
      cssReload = setTimeout(() => {
        cssReload = undefined;
        reloadCss(server, file);
      }, 200);
      return [];
    },
  };
}

function reloadCss(server: ViteDevServer, file: string) {
  const label = file.split(/[/\\]/).pop() ?? file;
  try {
    server.config.logger.info(`page reload ${label}`, { timestamp: true });
    server.ws.send({ type: "full-reload" });
  } catch (err) {
    server.config.logger.warn(
      `css reload skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
