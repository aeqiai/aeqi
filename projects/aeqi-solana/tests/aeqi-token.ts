import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AeqiToken } from "../target/types/aeqi_token";
import { AeqiCompany } from "../target/types/aeqi_company";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  createCompany as createTestCompany,
  expectTxFail,
  fundKeypair,
} from "./support";

describe("aeqi_token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.aeqiToken as Program<AeqiToken>;
  const trustProgram = anchor.workspace.aeqiCompany as Program<AeqiCompany>;

  function encodeTokenInitConfig(decimals: number, maxSupplyCap = 0) {
    const data = Buffer.alloc(9);
    data.writeUInt8(decimals, 0);
    data.writeBigUInt64LE(BigInt(maxSupplyCap), 1);
    return data;
  }

  async function createCompany(seed0: number, seed1 = 0) {
    return createTestCompany(
      provider,
      trustProgram,
      `aeqi-token-${seed0}-${seed1}`,
    );
  }

  async function finalizeTokenModule(
    trustPda: PublicKey,
    tokenModuleStatePda: PublicKey,
    decimals = 9,
  ) {
    const tokenConfigKey = new Uint8Array(32);
    tokenConfigKey[0] = 1;
    const [tokenBytesConfigPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("cfg_bytes"),
        trustPda.toBuffer(),
        Buffer.from(tokenConfigKey),
      ],
      trustProgram.programId,
    );

    await trustProgram.methods
      .setBytesConfig(
        Array.from(tokenConfigKey),
        encodeTokenInitConfig(decimals),
      )
      .accountsPartial({
        company: trustPda,
        config: tokenBytesConfigPda,
        sourceModule: null,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .finalize()
      .accountsPartial({
        company: trustPda,
        moduleState: tokenModuleStatePda,
        bytesConfig: tokenBytesConfigPda,
      })
      .rpc();
  }

  it("init creates a TokenModuleState PDA bound to a company", async () => {
    const fakeCompany = await createCompany(0xa0);

    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );

    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.tokenModuleState.fetch(moduleStatePda);
    expect(state.company.toBase58()).to.eq(fakeCompany.toBase58());
    expect(state.initialized).to.eq(1); // ModuleInitState::Initialized
    expect(state.mint.toBase58()).to.eq(PublicKey.default.toBase58());
  });

  it("init rejects a payer that is not the company authority", async () => {
    const fakeCompany = await createCompany(0xa0, 0xff);
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );
    const payer = await fundKeypair(provider);

    await expectTxFail(
      () =>
        program.methods
          .init()
          .accountsPartial({
            company: fakeCompany,
            moduleState: moduleStatePda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc(),
      /Unauthorized/,
    );
  });

  it("create_mint creates a Token-2022 mint as a PDA", async () => {
    const fakeCompany = await createCompany(0xa0, 1);

    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );

    // Init the module state first
    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(fakeCompany, moduleStatePda);

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), fakeCompany.toBuffer()],
      program.programId,
    );

    await program.methods
      .createMint(9)
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // module_state.mint should now be the mint PDA
    const state = await program.account.tokenModuleState.fetch(moduleStatePda);
    expect(state.mint.toBase58()).to.eq(mintPda.toBase58());

    // The mint account exists on-chain — verify by fetching its lamports
    const mintInfo = await provider.connection.getAccountInfo(mintPda);
    expect(mintInfo).to.not.be.null;
    expect(mintInfo!.owner.toBase58()).to.eq(TOKEN_2022_PROGRAM_ID.toBase58());
  });

  it("mint_tokens issues 1000 tokens to a recipient ATA", async () => {
    // Spawn fresh company + init + create_mint inline for isolation
    const fakeCompany = await createCompany(0xa1);
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), fakeCompany.toBuffer()],
      program.programId,
    );

    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(fakeCompany, moduleStatePda);
    await program.methods
      .createMint(9)
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Create the recipient's ATA (Token-2022 ATA is derived from the
    // Token-2022 program ID, not the legacy SPL Token program ID).
    const recipient = provider.wallet.publicKey;
    const ata = getAssociatedTokenAddressSync(
      mintPda,
      recipient,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const ataIx = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      ata,
      recipient,
      mintPda,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const ataTx = new anchor.web3.Transaction().add(ataIx);
    await provider.sendAndConfirm(ataTx);

    // Mint 1000 tokens
    await program.methods
      .mintTokens(new anchor.BN(1000))
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        recipientTa: ata,
        authority: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Verify balance
    const acct = await getAccount(
      provider.connection,
      ata,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(acct.amount.toString()).to.eq("1000");
    expect(acct.mint.toBase58()).to.eq(mintPda.toBase58());
    expect(acct.owner.toBase58()).to.eq(recipient.toBase58());
  });

  it("burn_tokens reduces supply when owner signs", async () => {
    // Spawn fresh company + init + create_mint + ATA + mint 5000 + burn 1500
    const fakeCompany = await createCompany(0xa2);
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), fakeCompany.toBuffer()],
      program.programId,
    );

    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(fakeCompany, moduleStatePda);
    await program.methods
      .createMint(9)
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const owner = provider.wallet.publicKey;
    const ata = getAssociatedTokenAddressSync(
      mintPda,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const ataIx = createAssociatedTokenAccountInstruction(
      owner,
      ata,
      owner,
      mintPda,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ataIx));

    await program.methods
      .mintTokens(new anchor.BN(5000))
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
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
    expect(acct.amount.toString()).to.eq("5000");

    await program.methods
      .burnTokens(new anchor.BN(1500))
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        mint: mintPda,
        ownerTa: ata,
        owner,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    acct = await getAccount(
      provider.connection,
      ata,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(acct.amount.toString()).to.eq("3500");
  });

  it("mint_tokens rejects callers that are not the company authority", async () => {
    const fakeCompany = await createCompany(0xa3);
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), fakeCompany.toBuffer()],
      program.programId,
    );

    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(fakeCompany, moduleStatePda);
    await program.methods
      .createMint(9)
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
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
    const ataIx = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      ata,
      recipient,
      mintPda,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ataIx));

    const attacker = await fundKeypair(provider);
    await expectTxFail(
      async () =>
        program.methods
          .mintTokens(new anchor.BN(1))
          .accountsPartial({
            company: fakeCompany,
            moduleState: moduleStatePda,
            mintAuthority: mintAuthorityPda,
            mint: mintPda,
            recipientTa: ata,
            authority: attacker.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc(),
      /UnauthorizedMintAuthority/,
    );
  });

  it("create_mint rejects a second mint for the same company", async () => {
    const fakeCompany = await createCompany(0xa3, 1);
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), fakeCompany.toBuffer()],
      program.programId,
    );

    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(fakeCompany, moduleStatePda);

    await program.methods
      .createMint(9)
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await expectTxFail(
      async () =>
        program.methods
          .createMint(9)
          .accountsPartial({
            company: fakeCompany,
            moduleState: moduleStatePda,
            mintAuthority: mintAuthorityPda,
            mint: mintPda,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            payer: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      /MintAlreadyCreated/,
    );
  });

  it("create_mint rejects the legacy SPL Token program", async () => {
    const fakeCompany = await createCompany(0xa3, 2);
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), fakeCompany.toBuffer()],
      program.programId,
    );

    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(fakeCompany, moduleStatePda);

    await expectTxFail(
      async () =>
        program.methods
          .createMint(9)
          .accountsPartial({
            company: fakeCompany,
            moduleState: moduleStatePda,
            mintAuthority: mintAuthorityPda,
            mint: mintPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            payer: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      /InvalidTokenProgram/,
    );
  });

  // The finalize→Finalized transition is now covered end-to-end by the
  // factory's createCompanyFull test (which exercises the full BytesConfig
  // dispatch path: factory.set_bytes_config → token.finalize → decoded
  // decimals + max_supply_cap on module_state). Re-running it standalone
  // here would require staging a fresh Company + BytesConfig PDA per test —
  // pure plumbing for no new coverage.
});
