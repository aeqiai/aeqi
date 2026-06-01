import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pkg from "./package.json" with { type: "json" };

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const webSharedSrc = fileURLToPath(new URL("../../packages/web-shared/src", import.meta.url));
const appNodeModules = fileURLToPath(new URL("./node_modules", import.meta.url));
const appNodeModulesReal = fs.existsSync(appNodeModules)
  ? fs.realpathSync(appNodeModules)
  : appNodeModules;
const emojiMartStub = fileURLToPath(new URL("./src/lib/stubs/emoji-mart.ts", import.meta.url));
const rainbowKitDistSegment = "/node_modules/@rainbow-me/rainbowkit/dist/";
const rainbowKitNonEnglishLocale =
  /^\.\/(?:ar_AR|de_DE|es_419|fr_FR|hi_IN|id_ID|ja_JP|ko_KR|ms_MY|pt_BR|ru_RU|th_TH|tr_TR|uk_UA|vi_VN|zh_CN|zh_HK|zh_TW)-[A-Z0-9]+\.js$/;
const emptyRainbowKitLocaleId = "\0aeqi-rainbowkit-empty-locale";
const apiProxyTarget = process.env.AEQI_UI_API_PROXY_TARGET || "http://localhost:8400";

function rainbowKitEnglishLocaleOnly(): PluginOption {
  return {
    name: "aeqi-rainbowkit-english-locale-only",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.includes(rainbowKitDistSegment) && rainbowKitNonEnglishLocale.test(source)) {
        return emptyRainbowKitLocaleId;
      }
      return null;
    },
    load(id) {
      if (id === emptyRainbowKitLocaleId) {
        return 'export default "{}";';
      }
      return null;
    },
  };
}

// `npm run build:analyze` (ANALYZE=1) writes an interactive treemap to
// `dist/stats.html` showing every chunk's bytes + which modules contributed.
// Plain `npm run build` skips it so CI dist payloads don't grow.
const analyzePlugins: PluginOption[] = process.env.ANALYZE
  ? [
      visualizer({
        filename: "dist/stats.html",
        template: "treemap",
        gzipSize: true,
        brotliSize: true,
        open: false,
      }) as PluginOption,
    ]
  : [];

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [rainbowKitEnglishLocaleOnly(), react(), ...analyzePlugins],
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
      // @blocknote/react's FloatingThreadController (Comments) dynamic-imports
      // emoji-mart + @emoji-mart/data (~700 KB of emoji JSON). We don't wire
      // comments/threadStore in BlockEditor, so the controller never mounts —
      // stubbing the modules drops the dead chunks from dist. See ae-021.
      "emoji-mart": emojiMartStub,
      "@emoji-mart/data": emojiMartStub,
    },
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
  build: {
    // The largest expected async vendor chunk is MetaMask SDK's browser
    // bundle (~549 KB raw). Keep the warning threshold just above that so
    // new app or vendor growth still surfaces without making the known
    // wallet-provider chunk permanent warning noise.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Manual chunks. Keep route/view lazy boundaries small and give
        // the heaviest vendor ecosystems stable cache buckets.
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
          // Keep Rollup/Vite runtime helpers in their own tiny chunk. If a
          // helper lands in a heavy manual chunk, Vite's dynamic-import
          // wrapper makes that heavy chunk an eager dependency of the app
          // entry and every lazy route.
          if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers.js")) {
            return "vite-runtime";
          }
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (
            id.includes("/node_modules/@blocknote/react/") ||
            id.includes("/node_modules/@blocknote/mantine/") ||
            id.includes("/node_modules/@mantine/")
          ) {
            return "editor-blocknote-ui";
          }
          if (id.includes("/node_modules/@blocknote/core/")) {
            return "editor-blocknote-core";
          }
          if (
            id.includes("/node_modules/@tiptap/") ||
            id.includes("/node_modules/prosemirror-") ||
            id.includes("/node_modules/y-prosemirror/")
          ) {
            return "editor-prosemirror";
          }
          if (
            id.includes("/node_modules/d3-force/") ||
            id.includes("/node_modules/d3-selection/") ||
            id.includes("/node_modules/d3-zoom/")
          ) {
            return "data-viz";
          }
          if (
            id.includes("/node_modules/react-markdown/") ||
            id.includes("/node_modules/remark-") ||
            id.includes("/node_modules/rehype-") ||
            id.includes("/node_modules/unified/") ||
            id.includes("/node_modules/micromark") ||
            id.includes("/node_modules/mdast-util-")
          ) {
            return "markdown";
          }
          if (id.includes("/node_modules/@metamask/sdk-communication-layer/")) {
            return "wallet-metamask-transport";
          }
          if (id.includes("/node_modules/@metamask/sdk-install-modal-web/")) {
            return "wallet-metamask-modal";
          }
          if (id.includes("/node_modules/@metamask/sdk/")) {
            return "wallet-metamask-sdk";
          }
          if (id.includes("/node_modules/@metamask/")) {
            return "wallet-metamask-core";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot, appNodeModulesReal],
    },
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
