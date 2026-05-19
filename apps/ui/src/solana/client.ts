/**
 * Shared Solana client + Anchor provider singletons for apps/ui.
 *
 * The browser is read-only: writes to the chain go through `aeqi-platform`
 * over HTTPS. Anchor's `Program<IDL>` constructor requires a provider with
 * a wallet, so we construct a read-only `AnchorProvider` backed by an
 * ephemeral in-memory `Keypair`. Any `program.methods.<ix>().rpc()` call
 * from the browser would attempt to sign with that throw-away keypair and
 * (correctly) be rejected by the chain — `program.methods.<ix>().view()`
 * and `program.account.<name>.fetch(...)` are the only safe surfaces.
 *
 * RPC URL is sourced from `VITE_SOLANA_RPC_URL` (Vite injects `import.meta.env`
 * at build time). Default `http://127.0.0.1:9120` matches the localnet
 * validator port declared in `projects/aeqi-solana/Anchor.toml`. Set the env
 * var to a mainnet RPC URL when the cluster flips.
 */
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, type ConfirmOptions, type Commitment } from "@solana/web3.js";

const DEFAULT_RPC_URL = "http://127.0.0.1:9120";
const DEFAULT_COMMITMENT: Commitment = "confirmed";

let cachedConnection: Connection | null = null;
let cachedProvider: AnchorProvider | null = null;

function resolveRpcUrl(): string {
  // import.meta.env is Vite-injected at build time; falls back to default on
  // bare Node (e.g. tests that import this module without vite's define).
  const fromEnv =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_SOLANA_RPC_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_RPC_URL;
}

/**
 * Returns a process-wide `Connection` configured with `confirmed`
 * commitment. Memoized so we don't re-construct the WebSocket subscription
 * tracker on every render.
 */
export function getConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(resolveRpcUrl(), DEFAULT_COMMITMENT);
  }
  return cachedConnection;
}

/**
 * Returns a process-wide read-only `AnchorProvider`. The wallet is a fresh
 * ephemeral keypair — useful only to satisfy Anchor's API; do NOT sign or
 * send transactions from this provider. Reads (`fetch`, `view`) are safe.
 */
export function getAnchorProvider(): AnchorProvider {
  if (!cachedProvider) {
    const connection = getConnection();
    const wallet = new Wallet(Keypair.generate());
    const opts: ConfirmOptions = {
      commitment: DEFAULT_COMMITMENT,
      preflightCommitment: DEFAULT_COMMITMENT,
    };
    cachedProvider = new AnchorProvider(connection, wallet, opts);
  }
  return cachedProvider;
}

/**
 * Test-only: drop the memoized connection + provider so a subsequent
 * `getConnection()` / `getAnchorProvider()` call re-reads the env. Never
 * call from production code.
 */
export function __resetSolanaClientForTests(): void {
  cachedConnection = null;
  cachedProvider = null;
}
