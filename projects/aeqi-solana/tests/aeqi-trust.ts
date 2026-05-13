import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AeqiTrust } from "../target/types/aeqi_trust";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { expectTxFail, fundKeypair } from "./support";

describe("aeqi_trust", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.aeqiTrust as Program<AeqiTrust>;
  const zeroHash = Array.from(new Uint8Array(32));
  const trustId = new Uint8Array(32).fill(0);
  trustId[0] = 1; // distinguish from default

  let trustPda: PublicKey;
  let trustBump: number;
  let modulePda: PublicKey;
  let v2ImplementationPda: PublicKey;

  before(() => {
    [trustPda, trustBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(trustId)],
      program.programId,
    );
  });

  it("initializes a trust in creation mode", async () => {
    await program.methods
      .initialize(Array.from(trustId))
      .accountsPartial({
        trust: trustPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const trust = await program.account.trust.fetch(trustPda);
    expect(trust.creationMode).to.eq(true);
    expect(trust.paused).to.eq(false);
    expect(trust.moduleCount).to.eq(0);
    expect(trust.authority.toBase58()).to.eq(
      provider.wallet.publicKey.toBase58(),
    );
  });

  it("registers a module while in creation mode", async () => {
    const moduleId = new Uint8Array(32).fill(0);
    moduleId[0] = 0x52; // 'R' for role

    const dummyProgram = Keypair.generate().publicKey;

    [modulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(moduleId)],
      program.programId,
    );

    await program.methods
      .registerModule(
        Array.from(moduleId),
        dummyProgram,
        provider.wallet.publicKey,
        new anchor.BN(1),
        zeroHash,
        new anchor.BN(0xff), // grant the lower 8 ACL flags
      )
      .accountsPartial({
        trust: trustPda,
        module: modulePda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const moduleAcct = await program.account.module.fetch(modulePda);
    expect(moduleAcct.programId.toBase58()).to.eq(dummyProgram.toBase58());
    expect(moduleAcct.provider.toBase58()).to.eq(
      provider.wallet.publicKey.toBase58(),
    );
    expect(moduleAcct.implementationVersion.toString()).to.eq("1");
    expect(
      Buffer.from(moduleAcct.implementationMetadataHash).equals(
        Buffer.alloc(32),
      ),
    ).to.eq(true);
    expect(moduleAcct.trustAcl.toString()).to.eq("255");
    expect(moduleAcct.initialized).to.eq(0); // Pending
  });

  it("lets a provider publish an implementation catalog entry", async () => {
    const moduleId = new Uint8Array(32).fill(0);
    moduleId[0] = 0x52;

    const version = new anchor.BN(2);
    const upgradedProgram = program.programId;
    const metadataHash = new Uint8Array(32).fill(0);
    metadataHash[0] = 0xbe;

    [v2ImplementationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("module_impl"),
        provider.wallet.publicKey.toBuffer(),
        Buffer.from(moduleId),
        version.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    await program.methods
      .publishModuleImplementation(
        Array.from(moduleId),
        version,
        Array.from(metadataHash),
      )
      .accountsPartial({
        implementation: v2ImplementationPda,
        implementationProgram: upgradedProgram,
        provider: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const published =
      await program.account.moduleImplementation.fetch(v2ImplementationPda);
    expect(published.active).to.eq(true);
    expect(published.implementationProgramId.toBase58()).to.eq(
      upgradedProgram.toBase58(),
    );
  });

  it("rejects publishing a zero implementation version", async () => {
    const moduleId = new Uint8Array(32).fill(0);
    moduleId[0] = 0x52;
    const zeroVersion = new anchor.BN(0);
    const [implementationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("module_impl"),
        provider.wallet.publicKey.toBuffer(),
        Buffer.from(moduleId),
        zeroVersion.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    await expectTxFail(
      async () =>
        program.methods
          .publishModuleImplementation(
            Array.from(moduleId),
            zeroVersion,
            zeroHash,
          )
          .accountsPartial({
            implementation: implementationPda,
            implementationProgram: program.programId,
            provider: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      /InvalidImplementationVersion/,
    );
  });

  it("finalizes the trust (exits creation mode)", async () => {
    await program.methods
      .finalize()
      .accountsPartial({
        trust: trustPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const trust = await program.account.trust.fetch(trustPda);
    expect(trust.creationMode).to.eq(false);
  });

  it("lets a finalized TRUST pull-upgrade one module implementation", async () => {
    await program.methods
      .adoptModuleImplementation(new anchor.BN(0x1ff))
      .accountsPartial({
        trust: trustPda,
        module: modulePda,
        implementation: v2ImplementationPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const moduleAcct = await program.account.module.fetch(modulePda);
    expect(moduleAcct.programId.toBase58()).to.eq(program.programId.toBase58());
    expect(moduleAcct.provider.toBase58()).to.eq(
      provider.wallet.publicKey.toBase58(),
    );
    expect(moduleAcct.implementationVersion.toString()).to.eq("2");
    expect(Buffer.from(moduleAcct.implementationMetadataHash)[0]).to.eq(0xbe);
    expect(moduleAcct.trustAcl.toString()).to.eq("511");
  });

  it("prevents non-providers and inactive implementations from changing TRUST modules", async () => {
    const attacker = await fundKeypair(provider);
    const moduleId = new Uint8Array(32).fill(0);
    moduleId[0] = 0x52;

    const inactiveVersion = new anchor.BN(3);
    const [inactiveImplPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("module_impl"),
        provider.wallet.publicKey.toBuffer(),
        Buffer.from(moduleId),
        inactiveVersion.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    await program.methods
      .publishModuleImplementation(
        Array.from(moduleId),
        inactiveVersion,
        zeroHash,
      )
      .accountsPartial({
        implementation: inactiveImplPda,
        implementationProgram: program.programId,
        provider: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await expectTxFail(
      async () =>
        program.methods
          .setModuleImplementationActive(false)
          .accountsPartial({
            implementation: inactiveImplPda,
            provider: attacker.publicKey,
          })
          .signers([attacker])
          .rpc(),
      /Unauthorized/,
    );

    await program.methods
      .setModuleImplementationActive(false)
      .accountsPartial({
        implementation: inactiveImplPda,
        provider: provider.wallet.publicKey,
      })
      .rpc();

    await expectTxFail(
      async () =>
        program.methods
          .adoptModuleImplementation(new anchor.BN(0x1ff))
          .accountsPartial({
            trust: trustPda,
            module: modulePda,
            implementation: inactiveImplPda,
            authority: provider.wallet.publicKey,
          })
          .rpc(),
      /InactiveImplementation/,
    );

    const activeVersion = new anchor.BN(4);
    const [activeImplPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("module_impl"),
        provider.wallet.publicKey.toBuffer(),
        Buffer.from(moduleId),
        activeVersion.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    await program.methods
      .publishModuleImplementation(
        Array.from(moduleId),
        activeVersion,
        zeroHash,
      )
      .accountsPartial({
        implementation: activeImplPda,
        implementationProgram: program.programId,
        provider: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await expectTxFail(
      async () =>
        program.methods
          .adoptModuleImplementation(new anchor.BN(0x1ff))
          .accountsPartial({
            trust: trustPda,
            module: modulePda,
            implementation: activeImplPda,
            authority: attacker.publicKey,
          })
          .signers([attacker])
          .rpc(),
      /Unauthorized/,
    );
  });

  it("rejects register_module after finalize", async () => {
    const moduleId = new Uint8Array(32).fill(0);
    moduleId[0] = 0x47; // 'G' for governance

    const [modulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), trustPda.toBuffer(), Buffer.from(moduleId)],
      program.programId,
    );

    let threw = false;
    try {
      await program.methods
        .registerModule(
          Array.from(moduleId),
          Keypair.generate().publicKey,
          provider.wallet.publicKey,
          new anchor.BN(1),
          zeroHash,
          new anchor.BN(0),
        )
        .accountsPartial({
          trust: trustPda,
          module: modulePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/NotInCreationMode/);
    }
    expect(threw).to.eq(true);
  });

  it("rejects post-finalize config writes from non-authority even with a high-ACL module account", async () => {
    const attacker = await fundKeypair(provider);

    const key = new Uint8Array(32).fill(0);
    key[0] = 0x99;
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("cfg_num"), trustPda.toBuffer(), Buffer.from(key)],
      program.programId,
    );

    await expectTxFail(
      async () =>
        program.methods
          .setNumericConfig(Array.from(key), new anchor.BN(42))
          .accountsPartial({
            trust: trustPda,
            config: configPda,
            sourceModule: modulePda,
            authority: attacker.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([attacker])
          .rpc(),
      /Unauthorized/,
    );
  });

  it("rejects finalize once creation mode is already closed", async () => {
    let threw = false;
    try {
      await program.methods
        .finalize()
        .accountsPartial({
          trust: trustPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/AlreadyFinalized/);
    }
    expect(threw).to.eq(true);
  });

  it("rejects finalize if no modules were registered", async () => {
    const emptyTrustId = new Uint8Array(32).fill(0);
    emptyTrustId[0] = 2;

    const [emptyTrustPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(emptyTrustId)],
      program.programId,
    );

    await program.methods
      .initialize(Array.from(emptyTrustId))
      .accountsPartial({
        trust: emptyTrustPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    let threw = false;
    try {
      await program.methods
        .finalize()
        .accountsPartial({
          trust: emptyTrustPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/NoModulesRegistered/);
    }
    expect(threw).to.eq(true);
  });
});
