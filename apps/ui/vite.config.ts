import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import pkg from "./package.json" with { type: "json" };

const webSharedSrc = fileURLToPath(new URL("../../packages/web-shared/src", import.meta.url));
const appNodeModules = fileURLToPath(new URL("./node_modules", import.meta.url));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
      "@aeqi/web-shared": webSharedSrc,
      // Pin peer-deps of the shared package to apps/ui's node_modules so
      // imports inside packages/web-shared/* resolve regardless of where
      // the file lives on disk. Without this, Rollup walks up from the
      // package's own dir and finds nothing.
      react: `${appNodeModules}/react`,
      "react-dom": `${appNodeModules}/react-dom`,
      "react-router-dom": `${appNodeModules}/react-router-dom`,
    },
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
  build: {
    rollupOptions: {
      output: {
        // Manual chunks. Conservative: only carve out react itself so it
        // gets its own long-cache bucket. Everything else falls through
        // to rollup's per-import default chunking — wallet stack
        // (metamask-sdk, walletconnect, reown) already auto-splits into
        // multiple async chunks that only load when WalletProvider
        // mounts; editor stack (blocknote/tiptap/prosemirror) likewise
        // rides along with BlockEditor's `lazy(() => import(...))`.
        //
        // CRITICAL: do NOT use `id.includes("/react/")` for the
        // react-vendor split — that substring also matches
        // `@tiptap/react`, `@blocknote/react`, `wagmi/react`, etc.,
        // which vacuums their entire ecosystems (TipTap+ProseMirror
        // ~1.3MB) into the eager react-vendor chunk. Anchor on
        // `/node_modules/react/` (leading slash + no nesting) instead.
        // Pre-fix react-vendor was 1.44MB / 445KB gz; with the anchor
        // it's ~233KB / 74KB gz — a single character (`/`) saves
        // ~370KB gzipped on first paint.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router") ||
            id.includes("/node_modules/scheduler/")
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
