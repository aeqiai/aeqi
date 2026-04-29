import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import App from "./App";
import { wagmiConfig } from "./lib/wagmiConfig";
import { AnalyticsProvider, createAnalytics } from "./lib/analytics";
import "@rainbow-me/rainbowkit/styles.css";
import "./styles/index.css";

const analytics = createAnalytics();

// After a deploy, the browser may still be holding an old index.html whose
// lazy-chunk hashes no longer exist on the server (Vite removes previous
// hashed chunks on build). When React tries to import a stale chunk it throws
// `vite:preloadError` — the fix is to reload, which pulls the fresh
// index.html and its current hashes. Without this handler users see
// "Failed to fetch dynamically imported module" after every deploy.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    // Avoid reload loops. localStorage persists across the reload itself
    // (sessionStorage does NOT on a hard refresh, which is exactly what we're
    // triggering — the guard would be wiped and we'd re-reload forever if
    // the asset is actually missing rather than stale).
    const key = "aeqi:last-stale-reload";
    const last = Number(localStorage.getItem(key) || 0);
    if (Date.now() - last < 10_000) return;
    localStorage.setItem(key, String(Date.now()));
    window.location.reload();
  });
}

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()} modalSize="compact">
          <BrowserRouter>
            <AnalyticsProvider analytics={analytics}>
              <App />
            </AnalyticsProvider>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
