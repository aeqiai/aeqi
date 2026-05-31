#!/usr/bin/env node
/**
 * Sync Anchor IDL JSON + TS-type files from the canonical aeqi-solana
 * workspace into apps/ui/src/solana/generated/.
 *
 * Why a sync script: the source IDLs live under
 * projects/aeqi-solana/target/{idl,types}/, which is gitignored (anchor
 * regenerates it on every build). The UI build can't depend on a
 * gitignored sibling, so we copy the artifacts into src/solana/generated/
 * and commit those copies. The copies are the source of truth for the
 * UI's typed Program<IDL> usage.
 *
 * Run manually after `anchor build` lands a fresh IDL:
 *   node apps/ui/scripts/sync-solana-idls.mjs
 *
 * Programs (11 total — must match projects/aeqi-solana/Anchor.toml
 * [programs.localnet]):
 *   aeqi_budget · aeqi_factory · aeqi_fund · aeqi_funding · aeqi_governance
 *   aeqi_role · aeqi_token · aeqi_treasury · aeqi_company · aeqi_unifutures
 *   aeqi_vesting
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DEST = resolve(__dirname, "..", "src", "solana", "generated");
const DEST_IDL = join(DEST, "idl");
const DEST_TYPES = join(DEST, "types");

/**
 * Source candidates for the IDL/types. `target/` is gitignored, so a fresh
 * worktree won't have them. Fall back to the canonical aeqi checkout when
 * the in-worktree target is missing. CI and the canonical repo will both
 * have the in-worktree target populated by `anchor build`.
 */
const SRC_CANDIDATES = [
  {
    idl: join(REPO_ROOT, "projects", "aeqi-solana", "target", "idl"),
    types: join(REPO_ROOT, "projects", "aeqi-solana", "target", "types"),
  },
  {
    idl: "/home/claudedev/aeqi/projects/aeqi-solana/target/idl",
    types: "/home/claudedev/aeqi/projects/aeqi-solana/target/types",
  },
];

let SRC_IDL = "";
let SRC_TYPES = "";
for (const candidate of SRC_CANDIDATES) {
  if (existsSync(candidate.idl) && existsSync(candidate.types)) {
    SRC_IDL = candidate.idl;
    SRC_TYPES = candidate.types;
    break;
  }
}

const PROGRAMS = [
  "aeqi_budget",
  "aeqi_factory",
  "aeqi_fund",
  "aeqi_funding",
  "aeqi_governance",
  "aeqi_role",
  "aeqi_token",
  "aeqi_treasury",
  "aeqi_company",
  "aeqi_unifutures",
  "aeqi_vesting",
];

if (!SRC_IDL || !SRC_TYPES) {
  console.error(
    `[sync-solana-idls] Source IDL/types not found in any candidate path.\n` +
      `  Run \`cd projects/aeqi-solana && anchor build\` first.`,
  );
  process.exit(1);
}

mkdirSync(DEST_IDL, { recursive: true });
mkdirSync(DEST_TYPES, { recursive: true });

const idlsOnDisk = new Set(readdirSync(SRC_IDL).filter((f) => f.endsWith(".json")));
const typesOnDisk = new Set(readdirSync(SRC_TYPES).filter((f) => f.endsWith(".ts")));

let copied = 0;
for (const program of PROGRAMS) {
  const idlFile = `${program}.json`;
  const typeFile = `${program}.ts`;

  if (!idlsOnDisk.has(idlFile)) {
    console.error(`[sync-solana-idls] Missing IDL: ${idlFile}`);
    process.exit(1);
  }
  if (!typesOnDisk.has(typeFile)) {
    console.error(`[sync-solana-idls] Missing TS type: ${typeFile}`);
    process.exit(1);
  }

  copyFileSync(join(SRC_IDL, idlFile), join(DEST_IDL, idlFile));
  copyFileSync(join(SRC_TYPES, typeFile), join(DEST_TYPES, typeFile));
  copied += 1;
}

console.log(`[sync-solana-idls] Copied ${copied} program IDL/type pairs to src/solana/generated/.`);
