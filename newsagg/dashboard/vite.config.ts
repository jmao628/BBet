import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The built app is served by the same local `http.server` that serves the
// scraped JSON (repo root), at /newsagg/web/dashboard/. In dev, Vite proxies
// /data to that server so the poller can read the JSON.
export default defineConfig({
  base: "/newsagg/web/dashboard/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../web/dashboard",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/data": "http://localhost:8000",
    },
  },
});
