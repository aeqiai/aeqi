# ERC-4337 Bundler Deployment

Service: `aeqi-bundler.service` — rundler v0.11.0 (Alchemy) targeting local dev anvil.

## Topology

```
anvil :8545 (chain 31337)
  └── aeqi-bundler :3000 (JSON-RPC) + :8181 (metrics)
        └── EntryPoint v0.7 @ 0x0000000071727De22E5E9d8BAf0edAc6f37da032
```

The bundler runs as the `aeqi-bundler` system user. Its signing key
(`0xA7AA4b840a93a639F22b125053C696A9D22a8C8d`) is separate from the anvil
deploy account; it holds 1 ETH seeded from account 0.

## Files

| Path | Purpose |
|---|---|
| `/usr/local/bin/rundler` | rundler v0.11.0 x86_64-linux binary |
| `/usr/local/bin/aeqi-bundler-preflight` | Seeds EntryPoint v0.7 bytecode at canonical address |
| `/etc/aeqi-bundler/env` | Env vars — mode 600, aeqi-bundler owner |
| `/etc/aeqi-bundler/chain-spec.toml` | Custom chain spec (id=31337, EP v0.7 address) |
| `/etc/systemd/system/aeqi-bundler.service` | systemd unit |
| `/var/lib/aeqi-bundler/` | Service working directory |

## Why a custom chain spec

rundler's built-in `--network dev` hardcodes `chainId = 1337`. foundry anvil
defaults to `31337`. If these disagree, UserOp hashes computed by the bundler
(which commit the chain ID) will not match what clients sign. The custom
`/etc/aeqi-bundler/chain-spec.toml` sets `id = 31337` and points the EP to the
canonical v0.7 address.

## EntryPoint v0.7 on dev anvil

The canonical EntryPoint v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`) is
not at that address on a fresh anvil; its canonical deployment depends on the
eth-infinitism deterministic deployer setup. Instead we:

1. Deploy EP from the `@account-abstraction/contracts@0.7.0` package via `cast send --create`
   to get the runtime bytecode.
2. Seed that bytecode at the canonical address with `anvil_setCode`.

This is handled automatically by `aeqi-bundler-preflight` on every service start.
It is idempotent — if the address already has code it is a no-op.

**`anvil_setCode` does not persist across anvil restarts.** If anvil is restarted
the preflight re-seeds on the next `systemctl start aeqi-bundler`. This is
intentional — the bundler will fail to start if anvil is not running, so the
dependency is made explicit.

## Service management

```bash
# Start (leaves Disabled — autostart requires explicit enable)
systemctl start aeqi-bundler

# Enable autostart after you've validated end-to-end
systemctl enable aeqi-bundler

# Status + recent logs
systemctl status aeqi-bundler
journalctl -u aeqi-bundler -f

# Restart after config change
systemctl restart aeqi-bundler
```

## Smoke test recipe

```bash
# 1. Verify supported entry points
curl -s http://127.0.0.1:3000 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_supportedEntryPoints","params":[],"id":1}'
# Expect: {"result":["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]}

# 2. Verify chain ID matches anvil (31337 = 0x7a69)
curl -s http://127.0.0.1:3000 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":2}'
# Expect: {"result":"0x7a69"}

# 3. Run integration smoke tests
cargo test -p aeqi-paymaster --test it_bundler_smoke -- --nocapture
# Expect: 3 tests pass
```

## Troubleshooting

**`ExecStartPre` fails: "reference EntryPoint at 0x40918... not deployed"**

The reference EP deployment (from the initial `cast send --create`) is
on-disk in anvil's state. If anvil was wiped and restarted, redeploy:

```bash
EP_BYTECODE=$(node -e "const d=require('/tmp/package/artifacts/EntryPoint.json'); process.stdout.write(d.bytecode);")
cast send \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --create "$EP_BYTECODE"
# Then: systemctl start aeqi-bundler
```

**Chain ID mismatch in UserOp signatures**

All clients must sign UserOps with chain ID 31337. The bundler enforces this
via the chain spec. If you see hash mismatches, verify the client is using
chainId 31337, not 1337.

**Port 8181 conflicts (metrics)**

If another service occupies 8181, update `METRICS_PORT` in
`/etc/aeqi-bundler/env` and `systemctl restart aeqi-bundler`.

**Bundler signer key rotation**

Edit `SIGNER_PRIVATE_KEYS` in `/etc/aeqi-bundler/env` and fund the new address
from anvil account 0 before restarting. The key address is:
`0xA7AA4b840a93a639F22b125053C696A9D22a8C8d`.
