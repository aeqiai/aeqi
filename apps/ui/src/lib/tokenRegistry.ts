/**
 * Canonical token symbol registry.
 *
 * Treasury balances arrive from the indexer keyed by chain + address. The
 * indexer doesn't surface symbols, so the UI resolves them locally against
 * this registry. Unknown tokens fall back to a truncated address.
 *
 * Keys are normalized to lowercase. Lookups must lowercase the address.
 */

export interface TokenInfo {
  /** Canonical symbol shown to users (e.g. "USDC"). */
  symbol: string;
  /** Decimals for human-readable formatting. Defaults to 18 when absent. */
  decimals?: number;
}

/**
 * Chain IDs the registry covers today. Use the wagmi/chain numeric IDs.
 *  - 1     mainnet
 *  - 8453  base
 *  - 84532 base sepolia
 *  - 31337 anvil (local dev)
 */
type ChainId = 1 | 8453 | 84532 | 31337 | number;

/** Registry: chainId → lowercased address → TokenInfo. */
const REGISTRY: Record<number, Record<string, TokenInfo>> = {
  // Base mainnet
  8453: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
    "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  },
  // Base Sepolia
  84532: {
    "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 },
    "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  },
  // Mainnet (kept for completeness — mainnet Companies are not deployed today)
  1: {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18 },
  },
};

/** Truncate an address as a graceful fallback when the registry doesn't know it. */
function truncateAddress(addr: string): string {
  if (!addr || !addr.startsWith("0x") || addr.length < 8) return addr;
  return `${addr.slice(0, 6)}…`;
}

/**
 * Resolve a token symbol from a contract address.
 *
 * @param address Token contract address (any case).
 * @param chainId Optional chain ID. When omitted, the registry is searched
 *                across all chains — useful while we don't surface chainId
 *                from the indexer payload yet.
 */
export function resolveSymbol(address: string | undefined, chainId?: ChainId): string {
  if (!address) return "?";
  const lc = address.toLowerCase();

  if (chainId != null) {
    const chainMap = REGISTRY[chainId];
    if (chainMap?.[lc]) return chainMap[lc].symbol;
  } else {
    for (const map of Object.values(REGISTRY)) {
      if (map[lc]) return map[lc].symbol;
    }
  }

  return truncateAddress(address);
}

/**
 * Resolve full token metadata. Returns `null` when the address is unknown
 * — callers should fall back to a truncated address for the symbol and 18
 * decimals for formatting.
 */
export function resolveToken(address: string | undefined, chainId?: ChainId): TokenInfo | null {
  if (!address) return null;
  const lc = address.toLowerCase();
  if (chainId != null) {
    return REGISTRY[chainId]?.[lc] ?? null;
  }
  for (const map of Object.values(REGISTRY)) {
    if (map[lc]) return map[lc];
  }
  return null;
}
