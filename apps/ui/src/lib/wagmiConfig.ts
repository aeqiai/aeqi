import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  walletConnectWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

// Self-hosted-first wallet config.
//
// We deliberately do NOT depend on WalletConnect (Reown) by default. The
// browser-extension wallets — MetaMask, Rabby, Coinbase Wallet, Brave, and
// anything else injected via EIP-1193 — communicate with the page directly,
// no external relay needed. That covers the majority of users with zero
// third-party dependencies.
//
// To enable mobile-wallet support (Phantom, Rainbow, Trust, Argent, etc.,
// connecting via QR / deeplink), the operator sets
// `VITE_WALLETCONNECT_PROJECT_ID` to a free projectId from cloud.reown.com.
// We add the WalletConnect connector only when that's set, so a fresh
// `git clone && deploy.sh` self-host has no Reown / WalletConnect account
// requirement and emits no relay warnings.
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

const baseWallets = [metaMaskWallet, rabbyWallet, coinbaseWallet, injectedWallet];
const wallets = projectId ? [...baseWallets, walletConnectWallet] : baseWallets;

const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: "aeqi",
  // RainbowKit requires a string here. When WalletConnect isn't in the list
  // it's never read; pass an empty string in that case.
  projectId: projectId ?? "",
});

export const wagmiConfig = createConfig({
  connectors,
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: false,
});
