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
  companyId: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("company"), Buffer.from(companyId)],
    trustProgramId,
  )[0];
}

export function modulePda(
  trustProgramId: PublicKey,
  company: PublicKey,
  moduleId: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("module"), company.toBuffer(), Buffer.from(moduleId)],
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
  company: PublicKey,
  sourceModuleId: Uint8Array,
  targetModuleId: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("acl_edge"),
      company.toBuffer(),
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
  companyId,
  authority,
}: {
  factoryProgramId: PublicKey;
  trustProgramId: PublicKey;
  templateId: Uint8Array;
  companyId: Uint8Array;
  authority: PublicKey;
}) {
  return {
    template: templatePda(factoryProgramId, templateId),
    company: trustPda(trustProgramId, companyId),
    authority,
    aeqiCompanyProgram: trustProgramId,
    systemProgram: anchor.web3.SystemProgram.programId,
  };
}

export function buildInstantiateTemplateRemainingAccounts({
  trustProgramId,
  company,
  modules,
  aclEdges = [],
}: {
  trustProgramId: PublicKey;
  company: PublicKey;
  modules: ModuleSelection[];
  aclEdges?: AclEdgeSelection[];
}): {
  modulePdas: PublicKey[];
  implementationPdas: PublicKey[];
  aclEdgePdas: PublicKey[];
  remainingAccounts: AccountMeta[];
} {
  const modulePdas = modules.map((module) =>
    modulePda(trustProgramId, company, module.moduleId),
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
      company,
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
