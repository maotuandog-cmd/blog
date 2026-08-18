import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const UI_HOST = process.env.HERMES_UI_HOST || "192.168.85.144";
const UI_PORT = Number(process.env.HERMES_UI_PORT || 5173);
const GW = process.env.HERMES_GATEWAY_URL || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    host: UI_HOST,
    port: UI_PORT,
    strictPort: true,
    proxy: {
      "/v1": GW,
      "/healthz": GW,
      "/readyz": GW,
      "/metrics": GW,
      "/bw": {
        target: process.env.HERMES_BROWSER_WORKER_URL || "http://127.0.0.1:8090",
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/bw/, ""),
      },
    },
  },
  preview: {
    host: UI_HOST,
    port: UI_PORT,
    strictPort: true,
  },
});
