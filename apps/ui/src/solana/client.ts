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
 * at build time). Local development falls back to `http://127.0.0.1:9120`,
 * matching the validator port declared in `projects/aeqi-solana/Anchor.toml`.
 * Hosted browsers must opt into a browser-reachable RPC; otherwise direct reads
 * are disabled so production never tries loopback/private-network RPC.
 */
import { AnchorProvider, type Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  type ConfirmOptions,
  type Commitment,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

const DEFAULT_RPC_URL = "http://127.0.0.1:9120";
const DEFAULT_COMMITMENT: Commitment = "confirmed";

let cachedConnection: Connection | null = null;
let cachedProvider: AnchorProvider | null = null;

function configuredRpcUrl(): string | undefined {
  // import.meta.env is Vite-injected at build time; falls back to default on
  // bare Node (e.g. tests that import this module without vite's define).
  return (
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_SOLANA_RPC_URL
  );
}

type BrowserLocation = Pick<Location, "hostname" | "protocol">;

function currentBrowserLocation(): BrowserLocation | null {
  if (typeof window === "undefined") return null;
  return window.location;
}

function isHostedBrowser(location: BrowserLocation | null): boolean {
  if (!location) return false;
  const { hostname, protocol } = location;
  if (protocol === "file:") return false;
  return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
}

function isLoopbackRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

export function isDirectSolanaRpcEnabled(): boolean {
  const fromEnv = configuredRpcUrl();
  const rpcUrl = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_RPC_URL;
  return !shouldBlockDirectSolanaRpc(rpcUrl, currentBrowserLocation());
}

export function shouldBlockDirectSolanaRpc(
  rpcUrl: string,
  location: BrowserLocation | null,
): boolean {
  return isHostedBrowser(location) && isLoopbackRpcUrl(rpcUrl);
}

function resolveRpcUrl(): string {
  const fromEnv = configuredRpcUrl();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_RPC_URL;
}

export function assertDirectSolanaRpcEnabled(
  rpcUrl: string = resolveRpcUrl(),
  location: BrowserLocation | null = currentBrowserLocation(),
): void {
  if (!shouldBlockDirectSolanaRpc(rpcUrl, location)) return;
  throw new Error(
    "Direct Solana RPC is disabled for hosted browsers without a browser-reachable VITE_SOLANA_RPC_URL.",
  );
}

/**
 * Returns a process-wide `Connection` configured with `confirmed`
 * commitment. Memoized so we don't re-construct the WebSocket subscription
 * tracker on every render.
 */
export function getConnection(): Connection {
  assertDirectSolanaRpcEnabled();
  if (!cachedConnection) {
    cachedConnection = new Connection(resolveRpcUrl(), DEFAULT_COMMITMENT);
  }
  return cachedConnection;
}

/**
 * Read-only wallet stub used to satisfy Anchor's `AnchorProvider` API in
 * the browser. `@coral-xyz/anchor`'s built-in `Wallet` class is exported
 * only from the Node bundle (it loads keypairs from `fs`); the browser
 * bundle has no `Wallet` symbol at all. Re-implementing the minimal
 * interface here keeps the browser bundle Node-free while still giving
 * Anchor a `publicKey` + signing seam.
 *
 * The keypair is ephemeral and never reaches the chain — `sign*`
 * surfaces below will sign with it, and any resulting transaction would
 * be (correctly) rejected by the cluster. The right surfaces in the
 * browser are `program.account.<name>.fetch(...)` and
 * `program.methods.<ix>().view()`; writes belong on aeqi-platform.
 */
class ReadOnlyBrowserWallet implements Wallet {
  readonly payer: Keypair;
  readonly publicKey: Keypair["publicKey"];

  constructor(payer: Keypair) {
    this.payer = payer;
    this.publicKey = payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("partialSign" in tx) {
      (tx as Transaction).partialSign(this.payer);
    } else {
      (tx as VersionedTransaction).sign([this.payer]);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

/**
 * Returns a process-wide read-only `AnchorProvider`. The wallet is a fresh
 * ephemeral keypair — useful only to satisfy Anchor's API; do NOT sign or
 * send transactions from this provider. Reads (`fetch`, `view`) are safe.
 */
export function getAnchorProvider(): AnchorProvider {
  if (!cachedProvider) {
    const connection = getConnection();
    const wallet = new ReadOnlyBrowserWallet(Keypair.generate());
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
