import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const polling =
  process.env.CHOKIDAR_USEPOLLING === "1" ||
  process.env.CHOKIDAR_USEPOLLING === "true";
const hmrClientPort = Number(process.env.SIGHTLOOP_HMR_CLIENT_PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Docker Desktop on Windows does not deliver inotify events into the VM.
    watch: polling ? { usePolling: true, interval: 300 } : undefined,
    // The browser opens the published host port (5176), not the port Vite binds.
    hmr:
      Number.isFinite(hmrClientPort) && hmrClientPort > 0
        ? { clientPort: hmrClientPort }
        : undefined,
  },
});
