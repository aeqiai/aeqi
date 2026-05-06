import type { ReactNode } from "react";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmiConfig";
import "@rainbow-me/rainbowkit/styles.css";

// This module is lazy-loaded (React.lazy in main.tsx) so the entire
// rainbowkit + wagmi + wagmiConfig tree is excluded from the initial bundle.
// The wallet stack hydrates in parallel with the React tree — it's ready
// before any user action that needs a wallet.
//
// QueryClientProvider stays in main.tsx (not here) because react-query
// hooks are used throughout the app outside the wallet context.

export default function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={darkTheme()} modalSize="compact">
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
