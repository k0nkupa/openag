import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const DAEMON = "http://127.0.0.1:4747";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  base: "/",
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/rooms": DAEMON,
      "/work": DAEMON,
      "/results": DAEMON,
      "/bots": DAEMON,
      "/approvals": DAEMON,
      "/health": DAEMON,
      "/computer": DAEMON,
      "/stream": { target: DAEMON.replace("http", "ws"), ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // `pnpm -r test` runs this suite alongside the daemon's, so jsdom UI tests need headroom beyond the 5s default.
    testTimeout: 30_000,
  },
});
