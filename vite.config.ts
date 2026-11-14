import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
function devProxy() {
  const value = process.env.HARNESS_PORT ?? "4317";
  const port = Number(value);
  if (!/^\d{1,5}$/.test(value) || port < 1 || port > 65535) {
    throw new Error("HARNESS_PORT must be a port between 1 and 65535.");
  }
  const target = `http://127.0.0.1:${port}`;
  return { "/api": { target, changeOrigin: true }, "/widget-runtime": { target, changeOrigin: true } };
}

// Fixtures share the app root and plugins, not its live development proxy.
export const application = defineConfig({
  root: "apps/web",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true }
});

export default defineConfig(({ command }) => ({
  ...application,
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: command === "serve" && process.env.GEN_E2E !== "1" ? devProxy() : undefined }
}));
