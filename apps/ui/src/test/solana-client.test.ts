import { describe, expect, it } from "vitest";

import { assertDirectSolanaRpcEnabled, shouldBlockDirectSolanaRpc } from "@/solana/client";

describe("Solana browser RPC guard", () => {
  it("blocks the localnet fallback from hosted browsers", () => {
    expect(
      shouldBlockDirectSolanaRpc("http://127.0.0.1:9120", {
        hostname: "app.aeqi.ai",
        protocol: "https:",
      }),
    ).toBe(true);
  });

  it("keeps localhost localnet available during development", () => {
    expect(
      shouldBlockDirectSolanaRpc("http://127.0.0.1:9120", {
        hostname: "localhost",
        protocol: "http:",
      }),
    ).toBe(false);
  });

  it("allows explicit browser-reachable RPC endpoints in production", () => {
    expect(
      shouldBlockDirectSolanaRpc("https://rpc.example.com", {
        hostname: "app.aeqi.ai",
        protocol: "https:",
      }),
    ).toBe(false);
  });

  it("prevents Connection construction against hosted loopback RPC", () => {
    expect(() =>
      assertDirectSolanaRpcEnabled("http://127.0.0.1:9120", {
        hostname: "app.aeqi.ai",
        protocol: "https:",
      }),
    ).toThrow("Direct Solana RPC is disabled");
  });
});
