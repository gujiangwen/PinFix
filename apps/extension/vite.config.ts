import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "node:path";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      "@sightloop/sniff": resolve(__dirname, "../../packages/sniff/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: {
      port: 5174,
    },
  },
});
