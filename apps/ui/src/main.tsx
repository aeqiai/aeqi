import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import {
  AnalyticsProvider,
  createAnalytics,
  onConsentChange,
  readConsent,
  writeConsent,
} from "./lib/analytics";
import "./styles/index.css";

// WalletProvider is lazy-loaded so @rainbow-me/rainbowkit + wagmi + wagmiConfig
// are excluded from the initial bundle. The wallet chunk loads in parallel with
// first paint and is ready before any user action needs a wallet.
const WalletProvider = lazy(() => import("./components/WalletProvider"));

// Authed users have already accepted the privacy policy at signup, so
// analytics defaults to on for them. Anonymous app visitors (rare —
// the app is gated) stay null until they auth in or explicitly opt in.
// Once a user toggles consent in /me/preferences, that decision
// is respected on every subsequent boot.
if (typeof window !== "undefined" && readConsent() === null) {
  const hasToken = !!window.localStorage.getItem("aeqi_token");
  if (hasToken) writeConsent("all");
}

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
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <WalletProvider>
          <BrowserRouter>
            <AnalyticsProvider
              analytics={analytics}
              initiallyEnabled={readConsent() === "all"}
              subscribeConsent={(setEnabled) =>
                onConsentChange((level) => setEnabled(level === "all"))
              }
            >
              <App />
            </AnalyticsProvider>
          </BrowserRouter>
        </WalletProvider>
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
