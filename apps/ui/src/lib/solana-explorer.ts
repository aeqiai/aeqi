/**
 * Solana explorer URL helper — shared by every surface that needs to
 * deep-link a base58 address (Assets, Equity, Incorporation today) into
 * an external block explorer.
 *
 * `VITE_SOLANA_CLUSTER` mirrors the cluster the UI is reading from. The
 * `LaunchingReveal` component owns the same logic for the post-genesis
 * interstitial; pulling it into one module so a future cluster swap
 * (mainnet-beta → mainnet, or a vendored explorer swap) is a single-file
 * edit.
 *
 * solana.fm is preferred because it handles localnet via `?cluster=` and
 * surfaces program-owned PDAs cleanly; Solana Explorer (explorer.solana.com)
 * would also work for mainnet but trips on localnet without a custom RPC.
 */

const SOLANA_CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as string | undefined) ?? "localnet-solana";

export function isMainnetCluster(): boolean {
  return SOLANA_CLUSTER === "mainnet" || SOLANA_CLUSTER === "mainnet-beta";
}

export function explorerAddressUrl(address: string): string {
  if (isMainnetCluster()) {
    return `https://solana.fm/address/${address}`;
  }
  return `https://solana.fm/address/${address}?cluster=${SOLANA_CLUSTER}`;
}

export function explorerTxUrl(signature: string): string {
  if (isMainnetCluster()) {
    return `https://solana.fm/tx/${signature}`;
  }
  return `https://solana.fm/tx/${signature}?cluster=${SOLANA_CLUSTER}`;
}

export function explorerClusterLabel(): string {
  return SOLANA_CLUSTER;
}
