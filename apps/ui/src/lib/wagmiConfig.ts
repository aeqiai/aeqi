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
  // RainbowKit's WalletConnect path validates this even when WC isn't in
  // the wallet list — a falsy value (undefined or empty string) throws
  // "No projectId found" at module init and crashes the React tree
  // before mount. Pass a non-empty placeholder when the operator hasn't
  // set VITE_WALLETCONNECT_PROJECT_ID; the value is never read unless
  // walletConnectWallet is in `wallets`, which only happens when the
  // operator has provided a real projectId.
  projectId: projectId || "self-hosted-no-walletconnect",
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
