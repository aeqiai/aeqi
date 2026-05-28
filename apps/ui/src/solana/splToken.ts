import type { Commitment, Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export const ACCOUNT_SIZE = 165;
export const MINT_SIZE = 82;

export interface Mint {
  address: PublicKey;
  mintAuthority: PublicKey | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: PublicKey | null;
  tlvData: Uint8Array | null;
}

export interface TokenAccount {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
}

function readU32Le(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) {
    throw new Error("SPL layout read out of bounds");
  }
  return (
    data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)
  );
}

function readU64Le(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) {
    throw new Error("SPL layout read out of bounds");
  }
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    value = (value << 8n) + BigInt(data[offset + i]);
  }
  return value;
}

function readPubkey(data: Uint8Array, offset: number): PublicKey {
  if (offset + 32 > data.length) {
    throw new Error("SPL layout read out of bounds");
  }
  return new PublicKey(data.slice(offset, offset + 32));
}

function readCOptionPubkey(data: Uint8Array, offset: number): PublicKey | null {
  return readU32Le(data, offset) === 0 ? null : readPubkey(data, offset + 4);
}

export function decodeTokenAccount(data: Uint8Array): TokenAccount {
  if (data.length < ACCOUNT_SIZE) {
    throw new Error(`SPL token account must be at least ${ACCOUNT_SIZE} bytes`);
  }
  return {
    mint: readPubkey(data, 0),
    owner: readPubkey(data, 32),
    amount: readU64Le(data, 64),
  };
}

export function decodeMint(address: PublicKey, data: Uint8Array): Mint {
  if (data.length < MINT_SIZE) {
    throw new Error(`SPL mint account must be at least ${MINT_SIZE} bytes`);
  }
  return {
    address,
    mintAuthority: readCOptionPubkey(data, 0),
    supply: readU64Le(data, 36),
    decimals: data[44],
    isInitialized: data[45] !== 0,
    freezeAuthority: readCOptionPubkey(data, 46),
    tlvData: data.length > MINT_SIZE ? data.slice(MINT_SIZE) : null,
  };
}

export async function getMint(
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment,
  programId: PublicKey = TOKEN_PROGRAM_ID,
): Promise<Mint> {
  const account = await connection.getAccountInfo(address, commitment);
  if (!account) {
    throw new Error(`mint account ${address.toBase58()} not found`);
  }
  if (!account.owner.equals(programId)) {
    throw new Error(`mint account ${address.toBase58()} is not owned by ${programId.toBase58()}`);
  }
  return decodeMint(address, account.data);
}

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) {
    throw new Error("owner is off curve");
  }
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBytes(), programId.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}
