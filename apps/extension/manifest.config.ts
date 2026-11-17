import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "SightLoop",
  description:
    "Pick UI elements, sniff React/Vue/DOM source, and open Daemon sessions.",
  version: "0.1.0",
  action: {
    default_title: "SightLoop",
    default_popup: "src/popup/index.html",
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["http://127.0.0.1:7420/*", "http://localhost:7420/*"],
  content_scripts: [
    {
      matches: ["http://localhost/*", "http://127.0.0.1/*", "https://*/*"],
      js: ["src/injected/main.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      matches: ["http://localhost/*", "http://127.0.0.1/*", "https://*/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  commands: {
    "toggle-pick": {
      suggested_key: {
        default: "Alt+Shift+A",
        mac: "Alt+Shift+A",
      },
      description: "Toggle SightLoop pick mode",
    },
  },
});
