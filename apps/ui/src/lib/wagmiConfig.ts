import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { http } from "viem";

// RainbowKit ships pre-built support for MetaMask, Rabby, Coinbase Wallet,
// WalletConnect (which transitively gives you Phantom, Trust, Rainbow,
// Argent, and any other mobile wallet), and the browser's native EIP-1193
// wallets. Adding more is a one-line addition to the `wallets` array if
// we want to pin a specific UX order.
//
// `projectId` is the WalletConnect project ID. We deliberately leave it as
// a development placeholder — for production it should be set via
// VITE_WALLETCONNECT_PROJECT_ID. WalletConnect still works without one for
// most use cases, just emits a console warning.
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "aeqi-walletconnect-dev";

export const wagmiConfig = getDefaultConfig({
  appName: "aeqi",
  projectId,
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: false,
});
