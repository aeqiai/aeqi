import * as anchor from "@coral-xyz/anchor";
import { AccountMeta, PublicKey } from "@solana/web3.js";

export type ModuleSelection = {
  moduleId: Uint8Array;
  provider: PublicKey;
  implementationVersion: anchor.BN;
};

export type AclEdgeSelection = {
  sourceModuleId: Uint8Array;
  targetModuleId: Uint8Array;
};

export function idFromHandle(handle: string): Uint8Array {
  if (handle.length > 32) throw new Error("handle must be <= 32 bytes");
  const id = new Uint8Array(32);
  for (let i = 0; i < handle.length; i++) id[i] = handle.charCodeAt(i);
  return id;
}

export function templatePda(
  factoryProgramId: PublicKey,
  templateId: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("template"), Buffer.from(templateId)],
    factoryProgramId,
  )[0];
}

export function trustPda(
  trustProgramId: PublicKey,
  trustId: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trust"), Buffer.from(trustId)],
    trustProgramId,
  )[0];
}

export function modulePda(
  trustProgramId: PublicKey,
  trust: PublicKey,
  moduleId: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("module"), trust.toBuffer(), Buffer.from(moduleId)],
    trustProgramId,
  )[0];
}

export function moduleImplementationPda(
  trustProgramId: PublicKey,
  provider: PublicKey,
  moduleId: Uint8Array,
  version: anchor.BN,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("module_impl"),
      provider.toBuffer(),
      Buffer.from(moduleId),
      version.toArrayLike(Buffer, "le", 8),
    ],
    trustProgramId,
  )[0];
}

export function moduleAclEdgePda(
  trustProgramId: PublicKey,
  trust: PublicKey,
  sourceModuleId: Uint8Array,
  targetModuleId: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("acl_edge"),
      trust.toBuffer(),
      Buffer.from(sourceModuleId),
      Buffer.from(targetModuleId),
    ],
    trustProgramId,
  )[0];
}

export function buildInstantiateTemplateAccounts({
  factoryProgramId,
  trustProgramId,
  templateId,
  trustId,
  authority,
}: {
  factoryProgramId: PublicKey;
  trustProgramId: PublicKey;
  templateId: Uint8Array;
  trustId: Uint8Array;
  authority: PublicKey;
}) {
  return {
    template: templatePda(factoryProgramId, templateId),
    trust: trustPda(trustProgramId, trustId),
    authority,
    aeqiTrustProgram: trustProgramId,
    systemProgram: anchor.web3.SystemProgram.programId,
  };
}

export function buildInstantiateTemplateRemainingAccounts({
  trustProgramId,
  trust,
  modules,
  aclEdges = [],
}: {
  trustProgramId: PublicKey;
  trust: PublicKey;
  modules: ModuleSelection[];
  aclEdges?: AclEdgeSelection[];
}): {
  modulePdas: PublicKey[];
  implementationPdas: PublicKey[];
  aclEdgePdas: PublicKey[];
  remainingAccounts: AccountMeta[];
} {
  const modulePdas = modules.map((module) =>
    modulePda(trustProgramId, trust, module.moduleId),
  );
  const implementationPdas = modules.map((module) =>
    moduleImplementationPda(
      trustProgramId,
      module.provider,
      module.moduleId,
      module.implementationVersion,
    ),
  );
  const aclEdgePdas = aclEdges.map((edge) =>
    moduleAclEdgePda(
      trustProgramId,
      trust,
      edge.sourceModuleId,
      edge.targetModuleId,
    ),
  );

  return {
    modulePdas,
    implementationPdas,
    aclEdgePdas,
    remainingAccounts: [
      ...modulePdas.map((pubkey) => ({
        pubkey,
        isWritable: true,
        isSigner: false,
      })),
      ...implementationPdas.map((pubkey) => ({
        pubkey,
        isWritable: false,
        isSigner: false,
      })),
      ...aclEdgePdas.map((pubkey) => ({
        pubkey,
        isWritable: true,
        isSigner: false,
      })),
    ],
  };
}
