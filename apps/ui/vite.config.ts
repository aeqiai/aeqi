import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import pkg from "./package.json" with { type: "json" };

const webSharedSrc = fileURLToPath(new URL("../../packages/web-shared/src", import.meta.url));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
      "@aeqi/web-shared": webSharedSrc,
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor split: react + router live in a separate chunk so the
        // browser can cache them across deploys (only re-rolls when the
        // vendor versions bump, not on every app commit).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8400",
        changeOrigin: true,
      },
    },
  },
});
