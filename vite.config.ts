import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  base: process.env.GSA_BASE ?? "/",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
} as Parameters<typeof defineConfig>[0]);
