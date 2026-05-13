import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AeqiFactory } from "../target/types/aeqi_factory";
import { AeqiTrust } from "../target/types/aeqi_trust";
import { AeqiRole } from "../target/types/aeqi_role";
import { AeqiToken } from "../target/types/aeqi_token";
import { AeqiGovernance } from "../target/types/aeqi_governance";
import { AeqiTreasury } from "../target/types/aeqi_treasury";
import { AeqiVesting } from "../target/types/aeqi_vesting";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { expectTxFail } from "./support";
import {
  buildInstantiateTemplateAccounts,
  buildInstantiateTemplateRemainingAccounts,
  moduleImplementationPda,
  templatePda as deriveTemplatePda,
} from "../scripts/factory-builders";

describe("aeqi_factory", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const factory = anchor.workspace.aeqiFactory as Program<AeqiFactory>;
  const trust = anchor.workspace.aeqiTrust as Program<AeqiTrust>;
  const role = anchor.workspace.aeqiRole as Program<AeqiRole>;
  const token = anchor.workspace.aeqiToken as Program<AeqiToken>;
  const governance = anchor.workspace.aeqiGovernance as Program<AeqiGovernance>;
  const treasury = anchor.workspace.aeqiTreasury as Program<AeqiTreasury>;
  const vesting = anchor.workspace.aeqiVesting as Program<AeqiVesting>;
  const zeroHash = Array.from(new Uint8Array(32));

  async function publishImplementation(
    moduleId: Uint8Array,
    implementationProgram: PublicKey,
    metadataHash = zeroHash,
    version = new anchor.BN(1),
  ) {
    const pda = moduleImplementationPda(
      trust.programId,
      provider.wallet.publicKey,
      moduleId,
      version,
    );
    await trust.methods
      .publishModuleImplementation(Array.from(moduleId), version, metadataHash)
      .accountsPartial({
        implementation: pda,
        implementationProgram,
        provider: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    return pda;
  }

  it("create_company spawns a trust via CPI to aeqi_trust::initialize", async () => {
    const trustId = new Uint8Array(32);
    trustId[0] = 0x42; // distinguish from the trust suite's trust

    const [trustPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(trustId)],
      trust.programId,
    );

    await factory.methods
      .createCompany(Array.from(trustId))
      .accountsPartial({
        trust: trustPda,
        authority: provider.wallet.publicKey,
        aeqiTrustProgram: trust.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Verify aeqi_trust state was actually written by the CPI.
    const trustAcct = await trust.account.trust.fetch(trustPda);
    expect(trustAcct.creationMode).to.eq(true);
    expect(trustAcct.authority.toBase58()).to.eq(
      provider.wallet.publicKey.toBase58(),
    );
    expect(trustAcct.moduleCount).to.eq(0);
    expect(Buffer.from(trustAcct.trustId).toString("hex")).to.eq(
      Buffer.from(trustId).toString("hex"),
    );
  });

  it("register_template stores a Template PDA", async () => {
    const templateId = new Uint8Array(32);
    templateId[0] = 0xaa;
    templateId[1] = 0xbb;

    const templatePda = deriveTemplatePda(factory.programId, templateId);

    const moduleId1 = new Uint8Array(32);
    moduleId1[0] = 0x52; // 'R'

    await factory.methods
      .registerTemplate(
        Array.from(templateId),
        [
          {
            moduleId: Array.from(moduleId1),
            programId: anchor.web3.Keypair.generate().publicKey,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: Array.from(new Uint8Array(32)),
            trustAcl: new anchor.BN(0xff),
          },
        ],
        [],
      )
      .accountsPartial({
        template: templatePda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const tmpl = await factory.account.template.fetch(templatePda);
    expect(tmpl.modules.length).to.eq(1);
    expect(tmpl.modules[0].provider.toBase58()).to.eq(
      provider.wallet.publicKey.toBase58(),
    );
    expect(tmpl.modules[0].implementationVersion.toString()).to.eq("1");
    expect(Buffer.from(tmpl.modules[0].implementationMetadataHash)[0]).to.eq(0);
    expect(tmpl.aclEdges.length).to.eq(0);
    expect(tmpl.admin.toBase58()).to.eq(provider.wallet.publicKey.toBase58());
  });

  it("rejects duplicate module ids in a template", async () => {
    const templateId = new Uint8Array(32);
    templateId[0] = 0xab;

    const templatePda = deriveTemplatePda(factory.programId, templateId);

    const moduleId = new Uint8Array(32);
    moduleId[0] = 0x52;

    let threw = false;
    try {
      await factory.methods
        .registerTemplate(
          Array.from(templateId),
          [
            {
              moduleId: Array.from(moduleId),
              programId: anchor.web3.Keypair.generate().publicKey,
              provider: provider.wallet.publicKey,
              implementationVersion: new anchor.BN(1),
              implementationMetadataHash: Array.from(new Uint8Array(32)),
              trustAcl: new anchor.BN(0xff),
            },
            {
              moduleId: Array.from(moduleId),
              programId: anchor.web3.Keypair.generate().publicKey,
              provider: provider.wallet.publicKey,
              implementationVersion: new anchor.BN(1),
              implementationMetadataHash: Array.from(new Uint8Array(32)),
              trustAcl: new anchor.BN(0x80),
            },
          ],
          [],
        )
        .accountsPartial({
          template: templatePda,
          admin: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/DuplicateModuleId/);
    }
    expect(threw).to.eq(true);
  });

  it("rejects acl edges that reference unknown module ids", async () => {
    const templateId = new Uint8Array(32);
    templateId[0] = 0xac;

    const [templatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("template"), Buffer.from(templateId)],
      factory.programId,
    );

    const moduleId = new Uint8Array(32);
    moduleId[0] = 0x52;
    const unknownModuleId = new Uint8Array(32);
    unknownModuleId[0] = 0x99;

    let threw = false;
    try {
      await factory.methods
        .registerTemplate(
          Array.from(templateId),
          [
            {
              moduleId: Array.from(moduleId),
              programId: anchor.web3.Keypair.generate().publicKey,
              provider: provider.wallet.publicKey,
              implementationVersion: new anchor.BN(1),
              implementationMetadataHash: Array.from(new Uint8Array(32)),
              trustAcl: new anchor.BN(0xff),
            },
          ],
          [
            {
              sourceModuleId: Array.from(moduleId),
              targetModuleId: Array.from(unknownModuleId),
              flags: new anchor.BN(1),
            },
          ],
        )
        .accountsPartial({
          template: templatePda,
          admin: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/UnknownAclModuleReference/);
    }
    expect(threw).to.eq(true);
  });

  it("create_with_modules atomically spawns trust + N modules + finalizes", async () => {
    const trustId = new Uint8Array(32);
    trustId[0] = 0x77;

    const [trustPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(trustId)],
      trust.programId,
    );

    const moduleIdRole = new Uint8Array(32);
    moduleIdRole[0] = 0x52; // 'R'
    const moduleIdGov = new Uint8Array(32);
    moduleIdGov[0] = 0x47; // 'G'

    const [modulePdaRole] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(moduleIdRole)],
      trust.programId,
    );
    const [modulePdaGov] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(moduleIdGov)],
      trust.programId,
    );

    const dummyRoleProg = anchor.web3.Keypair.generate().publicKey;
    const dummyGovProg = anchor.web3.Keypair.generate().publicKey;

    await factory.methods
      .createWithModules(Array.from(trustId), [
        {
          moduleId: Array.from(moduleIdRole),
          programId: dummyRoleProg,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
          implementationMetadataHash: Array.from(new Uint8Array(32)),
          trustAcl: new anchor.BN(0xff),
        },
        {
          moduleId: Array.from(moduleIdGov),
          programId: dummyGovProg,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
          implementationMetadataHash: Array.from(new Uint8Array(32)),
          trustAcl: new anchor.BN(0x80),
        },
      ])
      .accountsPartial({
        trust: trustPda,
        authority: provider.wallet.publicKey,
        aeqiTrustProgram: trust.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: modulePdaRole, isWritable: true, isSigner: false },
        { pubkey: modulePdaGov, isWritable: true, isSigner: false },
      ])
      .rpc();

    // Trust state — finalized, 2 modules registered
    const trustAcct = await trust.account.trust.fetch(trustPda);
    expect(trustAcct.creationMode).to.eq(false); // finalized
    expect(trustAcct.moduleCount).to.eq(2);

    // Both module PDAs were created with the right program IDs and ACLs
    const role = await trust.account.module.fetch(modulePdaRole);
    expect(role.programId.toBase58()).to.eq(dummyRoleProg.toBase58());
    expect(role.provider.toBase58()).to.eq(
      provider.wallet.publicKey.toBase58(),
    );
    expect(role.implementationVersion.toString()).to.eq("1");
    expect(role.trustAcl.toString()).to.eq("255");

    const gov = await trust.account.module.fetch(modulePdaGov);
    expect(gov.programId.toBase58()).to.eq(dummyGovProg.toBase58());
    expect(gov.provider.toBase58()).to.eq(provider.wallet.publicKey.toBase58());
    expect(gov.implementationVersion.toString()).to.eq("1");
    expect(gov.trustAcl.toString()).to.eq("128");
  });

  it("instantiate_template replays a registered template into a fresh TRUST", async () => {
    // Register a template first
    const templateId = new Uint8Array(32);
    templateId[0] = 0xa1;
    templateId[1] = 0x02;

    const [templatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("template"), Buffer.from(templateId)],
      factory.programId,
    );

    const moduleIdR = new Uint8Array(32);
    moduleIdR[0] = 0x52;
    moduleIdR[1] = 0xa1;
    const moduleIdT = new Uint8Array(32);
    moduleIdT[0] = 0x54;
    moduleIdT[1] = 0xa1;

    const programR = role.programId;
    const programT = token.programId;
    await publishImplementation(moduleIdR, programR);
    await publishImplementation(moduleIdT, programT);

    await factory.methods
      .registerTemplate(
        Array.from(templateId),
        [
          {
            moduleId: Array.from(moduleIdR),
            programId: programR,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
          {
            moduleId: Array.from(moduleIdT),
            programId: programT,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0x80),
          },
        ],
        [
          {
            sourceModuleId: Array.from(moduleIdR),
            targetModuleId: Array.from(moduleIdT),
            flags: new anchor.BN(0x40),
          },
        ],
      )
      .accountsPartial({
        template: templatePda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Now instantiate it against a fresh trust_id
    const trustId = new Uint8Array(32);
    trustId[0] = 0x88;
    trustId[1] = 0xa1;

    const instantiateAccounts = buildInstantiateTemplateAccounts({
      factoryProgramId: factory.programId,
      trustProgramId: trust.programId,
      templateId,
      trustId,
      authority: provider.wallet.publicKey,
    });
    const instantiateRemaining = buildInstantiateTemplateRemainingAccounts({
      trustProgramId: trust.programId,
      trust: instantiateAccounts.trust,
      modules: [
        {
          moduleId: moduleIdR,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
        {
          moduleId: moduleIdT,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
      ],
      aclEdges: [
        {
          sourceModuleId: moduleIdR,
          targetModuleId: moduleIdT,
        },
      ],
    });
    const [modR, modT] = instantiateRemaining.modulePdas;
    const [roleToTokenAcl] = instantiateRemaining.aclEdgePdas;

    await factory.methods
      .instantiateTemplate(Array.from(trustId))
      .accountsPartial(instantiateAccounts)
      .remainingAccounts(instantiateRemaining.remainingAccounts)
      .rpc();

    // Verify trust is finalized + 2 modules registered with right program IDs
    const t = await trust.account.trust.fetch(instantiateAccounts.trust);
    expect(t.creationMode).to.eq(false);
    expect(t.moduleCount).to.eq(2);

    const mR = await trust.account.module.fetch(modR);
    expect(mR.programId.toBase58()).to.eq(programR.toBase58());
    expect(mR.provider.toBase58()).to.eq(provider.wallet.publicKey.toBase58());
    expect(mR.implementationVersion.toString()).to.eq("1");
    expect(mR.trustAcl.toString()).to.eq("255");

    const mT = await trust.account.module.fetch(modT);
    expect(mT.programId.toBase58()).to.eq(programT.toBase58());
    expect(mT.provider.toBase58()).to.eq(provider.wallet.publicKey.toBase58());
    expect(mT.implementationVersion.toString()).to.eq("1");
    expect(mT.trustAcl.toString()).to.eq("128");

    const acl = await trust.account.moduleAclEdge.fetch(roleToTokenAcl);
    expect(Buffer.from(acl.sourceModuleId).toString("hex")).to.eq(
      Buffer.from(moduleIdR).toString("hex"),
    );
    expect(Buffer.from(acl.targetModuleId).toString("hex")).to.eq(
      Buffer.from(moduleIdT).toString("hex"),
    );
    expect(acl.flags.toString()).to.eq("64");
  });

  it("rejects instantiate_template when a selected implementation is inactive", async () => {
    const templateId = new Uint8Array(32);
    templateId[0] = 0xa1;
    templateId[1] = 0x03;

    const [templatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("template"), Buffer.from(templateId)],
      factory.programId,
    );

    const moduleId = new Uint8Array(32);
    moduleId[0] = 0x49;
    moduleId[1] = 0xa1;
    const impl = await publishImplementation(moduleId, role.programId);
    await trust.methods
      .setModuleImplementationActive(false)
      .accountsPartial({
        implementation: impl,
        provider: provider.wallet.publicKey,
      })
      .rpc();

    await factory.methods
      .registerTemplate(
        Array.from(templateId),
        [
          {
            moduleId: Array.from(moduleId),
            programId: role.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
        ],
        [],
      )
      .accountsPartial({
        template: templatePda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const trustId = new Uint8Array(32);
    trustId[0] = 0x89;
    trustId[1] = 0xa1;
    const instantiateAccounts = buildInstantiateTemplateAccounts({
      factoryProgramId: factory.programId,
      trustProgramId: trust.programId,
      templateId,
      trustId,
      authority: provider.wallet.publicKey,
    });
    const instantiateRemaining = buildInstantiateTemplateRemainingAccounts({
      trustProgramId: trust.programId,
      trust: instantiateAccounts.trust,
      modules: [
        {
          moduleId,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
      ],
    });

    await expectTxFail(
      async () =>
        factory.methods
          .instantiateTemplate(Array.from(trustId))
          .accountsPartial(instantiateAccounts)
          .remainingAccounts(instantiateRemaining.remainingAccounts)
          .rpc(),
      /InactiveImplementation/,
    );
  });

  it("create_company_full atomically spawns trust + registers + inits 3 modules in ONE tx", async () => {
    // Atomic orchestration:
    //   1. trust.initialize
    //   2. trust.register_module ×3 (role / token / governance)
    //   3. each module's init (creates module-state PDA)
    //   4. trust.finalize
    //   5. each module's finalize with config bytes via BytesConfig dispatch

    const trustId = new Uint8Array(32);
    trustId[0] = 0x99;
    trustId[1] = 0xaa;

    const roleModuleId = new Uint8Array(32);
    roleModuleId[0] = 0x52;
    const tokenModuleId = new Uint8Array(32);
    tokenModuleId[0] = 0x54;
    const govModuleId = new Uint8Array(32);
    govModuleId[0] = 0x47;

    const [trustPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(trustId)],
      trust.programId,
    );
    const [roleModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(roleModuleId)],
      trust.programId,
    );
    const [tokenModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(tokenModuleId)],
      trust.programId,
    );
    const [govModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(govModuleId)],
      trust.programId,
    );

    const [roleModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role_module"), trustPda.toBuffer()],
      role.programId,
    );
    const [tokenModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), trustPda.toBuffer()],
      token.programId,
    );
    const [govModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trustPda.toBuffer()],
      governance.programId,
    );

    // BytesConfig PDA for the token module's borsh-encoded TokenInitConfig.
    // Lives under aeqi_trust's program id; key is TOKEN_CONFIG_KEY = [1,0,...,0].
    const tokenConfigKey = new Uint8Array(32);
    tokenConfigKey[0] = 1;
    const [tokenBytesConfigPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("cfg_bytes"),
        trustPda.toBuffer(),
        Buffer.from(tokenConfigKey),
      ],
      trust.programId,
    );

    await factory.methods
      .createCompanyFull(
        Array.from(trustId),
        Array.from(roleModuleId),
        Array.from(tokenModuleId),
        Array.from(govModuleId),
        new anchor.BN(0xff),
        new anchor.BN(0xff),
        new anchor.BN(0xff),
        9, // token_decimals
        new anchor.BN(1_000_000_000), // token_max_supply_cap
      )
      .accountsPartial({
        trust: trustPda,
        roleModule: roleModulePda,
        tokenModule: tokenModulePda,
        govModule: govModulePda,
        roleModuleState: roleModuleStatePda,
        tokenModuleState: tokenModuleStatePda,
        govModuleState: govModuleStatePda,
        tokenBytesConfig: tokenBytesConfigPda,
        authority: provider.wallet.publicKey,
        aeqiTrustProgram: trust.programId,
        aeqiRoleProgram: role.programId,
        aeqiTokenProgram: token.programId,
        aeqiGovernanceProgram: governance.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Verify trust is finalized + 3 modules registered
    const t = await trust.account.trust.fetch(trustPda);
    expect(t.creationMode).to.eq(false);
    expect(t.moduleCount).to.eq(3);

    // Each module record has the right program ID
    const r = await trust.account.module.fetch(roleModulePda);
    expect(r.programId.toBase58()).to.eq(role.programId.toBase58());
    expect(r.provider.toBase58()).to.eq(role.programId.toBase58());
    expect(r.implementationVersion.toString()).to.eq("1");
    const tk = await trust.account.module.fetch(tokenModulePda);
    expect(tk.programId.toBase58()).to.eq(token.programId.toBase58());
    expect(tk.provider.toBase58()).to.eq(token.programId.toBase58());
    expect(tk.implementationVersion.toString()).to.eq("1");
    const g = await trust.account.module.fetch(govModulePda);
    expect(g.programId.toBase58()).to.eq(governance.programId.toBase58());
    expect(g.provider.toBase58()).to.eq(governance.programId.toBase58());
    expect(g.implementationVersion.toString()).to.eq("1");

    // Each module's state PDA was created — module init ran
    const rs = await role.account.roleModuleState.fetch(roleModuleStatePda);
    expect(rs.trust.toBase58()).to.eq(trustPda.toBase58());
    expect(rs.initialized).to.eq(true);

    const ts = await token.account.tokenModuleState.fetch(tokenModuleStatePda);
    expect(ts.trust.toBase58()).to.eq(trustPda.toBase58());
    // BytesConfig dispatch landed: finalize decoded the blob and copied
    // decimals + max_supply_cap onto module_state.
    expect(ts.decimals).to.eq(9);
    expect(ts.maxSupplyCap.toString()).to.eq("1000000000");

    const gs =
      await governance.account.governanceModuleState.fetch(govModuleStatePda);
    expect(gs.trust.toBase58()).to.eq(trustPda.toBase58());
  });

  it("max_supply_cap from TokenInitConfig is enforced by mint_tokens", async () => {
    // createCompanyFull → create_mint → mint up to cap → exceed (fails) →
    // residual headroom mint succeeds. Cap = 2000, decimals = 0 to keep
    // the math literal.
    const trustId = new Uint8Array(32);
    trustId[0] = 0xca;
    trustId[1] = 0xaa;

    const [trustPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(trustId)],
      trust.programId,
    );
    const roleModuleId = new Uint8Array(32);
    roleModuleId[0] = 0x52;
    const tokenModuleId = new Uint8Array(32);
    tokenModuleId[0] = 0x54;
    const govModuleId = new Uint8Array(32);
    govModuleId[0] = 0x47;

    const pdaModule = (id: Uint8Array) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(id)],
        trust.programId,
      )[0];
    const roleModulePda = pdaModule(roleModuleId);
    const tokenModulePda = pdaModule(tokenModuleId);
    const govModulePda = pdaModule(govModuleId);

    const [roleModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role_module"), trustPda.toBuffer()],
      role.programId,
    );
    const [tokenModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), trustPda.toBuffer()],
      token.programId,
    );
    const [govModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trustPda.toBuffer()],
      governance.programId,
    );

    const tokenConfigKey = new Uint8Array(32);
    tokenConfigKey[0] = 1;
    const [tokenBytesConfigPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("cfg_bytes"),
        trustPda.toBuffer(),
        Buffer.from(tokenConfigKey),
      ],
      trust.programId,
    );

    await factory.methods
      .createCompanyFull(
        Array.from(trustId),
        Array.from(roleModuleId),
        Array.from(tokenModuleId),
        Array.from(govModuleId),
        new anchor.BN(0xff),
        new anchor.BN(0xff),
        new anchor.BN(0xff),
        0, // decimals
        new anchor.BN(2000), // max_supply_cap
      )
      .accountsPartial({
        trust: trustPda,
        roleModule: roleModulePda,
        tokenModule: tokenModulePda,
        govModule: govModulePda,
        roleModuleState: roleModuleStatePda,
        tokenModuleState: tokenModuleStatePda,
        govModuleState: govModuleStatePda,
        tokenBytesConfig: tokenBytesConfigPda,
        authority: provider.wallet.publicKey,
        aeqiTrustProgram: trust.programId,
        aeqiRoleProgram: role.programId,
        aeqiTokenProgram: token.programId,
        aeqiGovernanceProgram: governance.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Now create the Token-2022 mint + an ATA, then try mints.
    const {
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync,
      createAssociatedTokenAccountInstruction,
      getAccount,
    } = await import("@solana/spl-token");

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), trustPda.toBuffer()],
      token.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), trustPda.toBuffer()],
      token.programId,
    );

    await token.methods
      .createMint(0)
      .accountsPartial({
        trust: trustPda,
        moduleState: tokenModuleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const recipient = provider.wallet.publicKey;
    const ata = getAssociatedTokenAddressSync(
      mintPda,
      recipient,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          ata,
          recipient,
          mintPda,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      ),
    );

    // Mint 1500 (under cap) — succeeds.
    await token.methods
      .mintTokens(new anchor.BN(1500))
      .accountsPartial({
        trust: trustPda,
        moduleState: tokenModuleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        recipientTa: ata,
        authority: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    let acct = await getAccount(
      provider.connection,
      ata,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(acct.amount.toString()).to.eq("1500");

    // Mint 600 more (1500+600=2100 > 2000) — must fail.
    let threw = false;
    try {
      await token.methods
        .mintTokens(new anchor.BN(600))
        .accountsPartial({
          trust: trustPda,
          moduleState: tokenModuleStatePda,
          mintAuthority: mintAuthorityPda,
          mint: mintPda,
          recipientTa: ata,
          authority: provider.wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/SupplyCapExceeded/);
    }
    expect(threw).to.eq(true);

    // Residual headroom: mint 500 (1500+500=2000 ≤ 2000) — succeeds.
    await token.methods
      .mintTokens(new anchor.BN(500))
      .accountsPartial({
        trust: trustPda,
        moduleState: tokenModuleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        recipientTa: ata,
        authority: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    acct = await getAccount(
      provider.connection,
      ata,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(acct.amount.toString()).to.eq("2000");
  });

  it("rejects register_template with empty module set", async () => {
    const templateId = new Uint8Array(32);
    templateId[0] = 0xee;

    const [templatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("template"), Buffer.from(templateId)],
      factory.programId,
    );

    let threw = false;
    try {
      await factory.methods
        .registerTemplate(Array.from(templateId), [], [])
        .accountsPartial({
          template: templatePda,
          admin: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/EmptyModuleSet/);
    }
    expect(threw).to.eq(true);
  });

  // Canonical templates registry: prove that the on-chain factory supports
  // multiple distinct named templates registered side-by-side, each with a
  // different module set. BASIC = role + token + governance (the baseline
  // entity shape). VENTURE = BASIC + treasury + vesting (the cap-table-company
  // shape that holds funds + has time-vested grants).
  //
  // What `instantiate_template` ships today: trust.initialize +
  // provider-published implementation validation + register_module per
  // template-spec'd module + ACL graph replay + trust.finalize. Per-module
  // init/finalize/set_bytes_config remains a separate caller step (each
  // module's own context shape varies). This test asserts the registry +
  // instantiation work; module init for the spawned trust is the next step
  // a real caller (or the platform bridge) would run.
  it("registers BASIC + VENTURE templates side-by-side and instantiates both", async () => {
    const BASIC_ID = (() => {
      const k = new Uint8Array(32);
      k[0] = 0x42;
      k[1] = 0x53;
      k[2] = 0x43;
      return k;
    })(); // 'BSC'
    const VENTURE_ID = (() => {
      const k = new Uint8Array(32);
      k[0] = 0x56;
      k[1] = 0x4e;
      k[2] = 0x54;
      return k;
    })(); // 'VNT'

    const moduleIdR = new Uint8Array(32);
    moduleIdR[0] = 0x52; // 'R' role
    const moduleIdT = new Uint8Array(32);
    moduleIdT[0] = 0x54; // 'T' token
    const moduleIdG = new Uint8Array(32);
    moduleIdG[0] = 0x47; // 'G' governance
    const moduleIdY = new Uint8Array(32);
    moduleIdY[0] = 0x59; // 'Y' treasury (no 'T' clash)
    const moduleIdV = new Uint8Array(32);
    moduleIdV[0] = 0x56; // 'V' vesting

    await publishImplementation(moduleIdR, role.programId);
    await publishImplementation(moduleIdT, token.programId);
    await publishImplementation(moduleIdG, governance.programId);
    await publishImplementation(moduleIdY, treasury.programId);
    await publishImplementation(moduleIdV, vesting.programId);

    // BASIC: role + token + governance
    const [basicPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("template"), Buffer.from(BASIC_ID)],
      factory.programId,
    );
    await factory.methods
      .registerTemplate(
        Array.from(BASIC_ID),
        [
          {
            moduleId: Array.from(moduleIdR),
            programId: role.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
          {
            moduleId: Array.from(moduleIdT),
            programId: token.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
          {
            moduleId: Array.from(moduleIdG),
            programId: governance.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
        ],
        [],
      )
      .accountsPartial({
        template: basicPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // VENTURE: role + token + governance + treasury + vesting
    const [venturePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("template"), Buffer.from(VENTURE_ID)],
      factory.programId,
    );
    await factory.methods
      .registerTemplate(
        Array.from(VENTURE_ID),
        [
          {
            moduleId: Array.from(moduleIdR),
            programId: role.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
          {
            moduleId: Array.from(moduleIdT),
            programId: token.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
          {
            moduleId: Array.from(moduleIdG),
            programId: governance.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
          {
            moduleId: Array.from(moduleIdY),
            programId: treasury.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
          {
            moduleId: Array.from(moduleIdV),
            programId: vesting.programId,
            provider: provider.wallet.publicKey,
            implementationVersion: new anchor.BN(1),
            implementationMetadataHash: zeroHash,
            trustAcl: new anchor.BN(0xff),
          },
        ],
        [],
      )
      .accountsPartial({
        template: venturePda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const basic = await factory.account.template.fetch(basicPda);
    expect(basic.modules.length).to.eq(3);
    const venture = await factory.account.template.fetch(venturePda);
    expect(venture.modules.length).to.eq(5);

    // Instantiate BASIC against a fresh trust.
    const trustIdBasic = new Uint8Array(32);
    trustIdBasic[0] = 0xb1;
    trustIdBasic[1] = 0x42;
    const basicAccounts = buildInstantiateTemplateAccounts({
      factoryProgramId: factory.programId,
      trustProgramId: trust.programId,
      templateId: BASIC_ID,
      trustId: trustIdBasic,
      authority: provider.wallet.publicKey,
    });
    const basicRemaining = buildInstantiateTemplateRemainingAccounts({
      trustProgramId: trust.programId,
      trust: basicAccounts.trust,
      modules: [
        {
          moduleId: moduleIdR,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
        {
          moduleId: moduleIdT,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
        {
          moduleId: moduleIdG,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
      ],
    });
    await factory.methods
      .instantiateTemplate(Array.from(trustIdBasic))
      .accountsPartial(basicAccounts)
      .remainingAccounts(basicRemaining.remainingAccounts)
      .rpc();

    const tBasic = await trust.account.trust.fetch(basicAccounts.trust);
    expect(tBasic.creationMode).to.eq(false);
    expect(tBasic.moduleCount).to.eq(3);
    // Sanity: each module record points at the right program.
    expect(
      (
        await trust.account.module.fetch(basicRemaining.modulePdas[0])
      ).programId.toBase58(),
    ).to.eq(role.programId.toBase58());
    expect(
      (
        await trust.account.module.fetch(basicRemaining.modulePdas[1])
      ).programId.toBase58(),
    ).to.eq(token.programId.toBase58());
    expect(
      (
        await trust.account.module.fetch(basicRemaining.modulePdas[2])
      ).programId.toBase58(),
    ).to.eq(governance.programId.toBase58());

    // Instantiate VENTURE against a different fresh trust — proves the same
    // factory can spawn distinct shapes from distinct registered templates.
    const trustIdVent = new Uint8Array(32);
    trustIdVent[0] = 0xb2;
    trustIdVent[1] = 0x56;
    const ventureAccounts = buildInstantiateTemplateAccounts({
      factoryProgramId: factory.programId,
      trustProgramId: trust.programId,
      templateId: VENTURE_ID,
      trustId: trustIdVent,
      authority: provider.wallet.publicKey,
    });
    const ventureRemaining = buildInstantiateTemplateRemainingAccounts({
      trustProgramId: trust.programId,
      trust: ventureAccounts.trust,
      modules: [
        {
          moduleId: moduleIdR,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
        {
          moduleId: moduleIdT,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
        {
          moduleId: moduleIdG,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
        {
          moduleId: moduleIdY,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
        {
          moduleId: moduleIdV,
          provider: provider.wallet.publicKey,
          implementationVersion: new anchor.BN(1),
        },
      ],
    });
    await factory.methods
      .instantiateTemplate(Array.from(trustIdVent))
      .accountsPartial(ventureAccounts)
      .remainingAccounts(ventureRemaining.remainingAccounts)
      .rpc();

    const tVent = await trust.account.trust.fetch(ventureAccounts.trust);
    expect(tVent.creationMode).to.eq(false);
    expect(tVent.moduleCount).to.eq(5);
    expect(
      (
        await trust.account.module.fetch(ventureRemaining.modulePdas[3])
      ).programId.toBase58(),
    ).to.eq(treasury.programId.toBase58());
    expect(
      (
        await trust.account.module.fetch(ventureRemaining.modulePdas[4])
      ).programId.toBase58(),
    ).to.eq(vesting.programId.toBase58());
  });
});
