import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AeqiGovernance } from "../target/types/aeqi_governance";
import { AeqiToken } from "../target/types/aeqi_token";
import { AeqiTrust } from "../target/types/aeqi_trust";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  createTrust as createTestTrust,
  expectTxFail,
  fundKeypair,
} from "./support";

describe("aeqi_governance", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.aeqiGovernance as Program<AeqiGovernance>;
  const trustProgram = anchor.workspace.aeqiTrust as Program<AeqiTrust>;
  const tokenProgram = anchor.workspace.aeqiToken as Program<AeqiToken>;

  let fakeTrust: PublicKey;
  let modulePda: PublicKey;

  before(async () => {
    fakeTrust = await createTestTrust(
      provider,
      trustProgram,
      "aeqi-governance",
    );

    [modulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), fakeTrust.toBuffer()],
      program.programId,
    );
  });

  function encodeTokenInitConfig(decimals: number, maxSupplyCap = 0) {
    const data = Buffer.alloc(9);
    data.writeUInt8(decimals, 0);
    data.writeBigUInt64LE(BigInt(maxSupplyCap), 1);
    return data;
  }

  async function finalizeTokenModule(
    trustPda: PublicKey,
    tokenModuleStatePda: PublicKey,
    maxSupplyCap = 0,
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
        encodeTokenInitConfig(9, maxSupplyCap),
      )
      .accountsPartial({
        trust: trustPda,
        config: tokenBytesConfigPda,
        sourceModule: null,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await tokenProgram.methods
      .finalize()
      .accountsPartial({
        trust: trustPda,
        moduleState: tokenModuleStatePda,
        bytesConfig: tokenBytesConfigPda,
      })
      .rpc();
  }

  async function createTrust(seed0: number, seed1 = 0) {
    const trustId = new Uint8Array(32);
    trustId[0] = seed0;
    trustId[1] = seed1;
    const [trustPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(trustId)],
      trustProgram.programId,
    );

    await trustProgram.methods
      .initialize(Array.from(trustId))
      .accountsPartial({
        trust: trustPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    return trustPda;
  }

  async function setupTokenVotingProposal(args: {
    seed0: number;
    seed1?: number;
    cfgId: Uint8Array;
    proposalId: Uint8Array;
    voteAmount: number;
    extraMintAmount?: number;
    castVote?: boolean;
    allowEarlyEnact?: boolean;
    executionDelay?: number;
  }) {
    const trustPda = await createTrust(args.seed0, args.seed1 ?? 0);

    const [tokenModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), trustPda.toBuffer()],
      tokenProgram.programId,
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), trustPda.toBuffer()],
      tokenProgram.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), trustPda.toBuffer()],
      tokenProgram.programId,
    );

    await tokenProgram.methods
      .init()
      .accountsPartial({
        trust: trustPda,
        moduleState: tokenModuleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(trustPda, tokenModuleStatePda);

    await tokenProgram.methods
      .createMint(9)
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

    const voter = provider.wallet.publicKey;
    const voterAta = getAssociatedTokenAddressSync(
      mintPda,
      voter,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          voter,
          voterAta,
          voter,
          mintPda,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      ),
    );

    if (args.voteAmount > 0) {
      await tokenProgram.methods
        .mintTokens(new anchor.BN(args.voteAmount))
        .accountsPartial({
          trust: trustPda,
          moduleState: tokenModuleStatePda,
          mintAuthority: mintAuthorityPda,
          mint: mintPda,
          recipientTa: voterAta,
          authority: provider.wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    }

    if ((args.extraMintAmount ?? 0) > 0) {
      const extraHolder = Keypair.generate().publicKey;
      const extraAta = getAssociatedTokenAddressSync(
        mintPda,
        extraHolder,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      await provider.sendAndConfirm(
        new anchor.web3.Transaction().add(
          createAssociatedTokenAccountInstruction(
            voter,
            extraAta,
            extraHolder,
            mintPda,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        ),
      );
      await tokenProgram.methods
        .mintTokens(new anchor.BN(args.extraMintAmount ?? 0))
        .accountsPartial({
          trust: trustPda,
          moduleState: tokenModuleStatePda,
          mintAuthority: mintAuthorityPda,
          mint: mintPda,
          recipientTa: extraAta,
          authority: provider.wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    }

    const [govModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trustPda.toBuffer()],
      program.programId,
    );
    await program.methods
      .init()
      .accountsPartial({
        trust: trustPda,
        moduleState: govModulePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_config"), trustPda.toBuffer(), Buffer.from(args.cfgId)],
      program.programId,
    );
    await program.methods
      .registerConfig(Array.from(args.cfgId), {
        proposalThreshold: new anchor.BN(0),
        quorumBps: 4000,
        supportBps: 5000,
        votingPeriod: new anchor.BN(60),
        executionDelay: new anchor.BN(args.executionDelay ?? 0),
        allowEarlyEnact: args.allowEarlyEnact ?? true,
      })
      .accountsPartial({
        trust: trustPda,
        moduleState: govModulePda,
        governanceConfig: cfgPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const [proposalPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        trustPda.toBuffer(),
        Buffer.from(args.proposalId),
      ],
      program.programId,
    );
    await program.methods
      .propose(
        Array.from(args.proposalId),
        Array.from(args.cfgId),
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        trust: trustPda,
        moduleState: govModulePda,
        proposal: proposalPda,
        proposer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: cfgPda, isSigner: false, isWritable: false },
      ])
      .rpc();

    const [votePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        trustPda.toBuffer(),
        Buffer.from(args.proposalId),
        voter.toBuffer(),
      ],
      program.programId,
    );

    if (args.castVote ?? true) {
      await program.methods
        .castVoteToken(1)
        .accountsPartial({
          proposal: proposalPda,
          vote: votePda,
          voterTokenAccount: voterAta,
          mint: mintPda,
          voter,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }

    return {
      trustPda,
      cfgPda,
      proposalPda,
      votePda,
      voterAta,
      mintPda,
      voter,
    };
  }

  it("init creates governance module state", async () => {
    await program.methods
      .init()
      .accountsPartial({
        trust: fakeTrust,
        moduleState: modulePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const m = await program.account.governanceModuleState.fetch(modulePda);
    expect(m.trust.toBase58()).to.eq(fakeTrust.toBase58());
    expect(m.proposalCount.toString()).to.eq("0");
    expect(m.configCount).to.eq(0);
  });

  it("init rejects a payer that is not the trust authority", async () => {
    const trust = await createTestTrust(
      provider,
      trustProgram,
      "aeqi-governance-unauthorized-init",
    );
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trust.toBuffer()],
      program.programId,
    );
    const payer = await fundKeypair(provider);

    await expectTxFail(
      () =>
        program.methods
          .init()
          .accountsPartial({
            trust,
            moduleState: moduleStatePda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc(),
      /Unauthorized/,
    );
  });

  it("registers a token-voting governance config", async () => {
    const tokenConfigId = new Uint8Array(32); // [0; 32] = token mode

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("gov_config"),
        fakeTrust.toBuffer(),
        Buffer.from(tokenConfigId),
      ],
      program.programId,
    );

    await program.methods
      .registerConfig(Array.from(tokenConfigId), {
        proposalThreshold: new anchor.BN(0),
        quorumBps: 4000,
        supportBps: 5000,
        votingPeriod: new anchor.BN(60 * 60 * 24 * 5), // 5 days
        executionDelay: new anchor.BN(0),
        allowEarlyEnact: false,
      })
      .accountsPartial({
        trust: fakeTrust,
        moduleState: modulePda,
        governanceConfig: cfgPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.governanceConfig.fetch(cfgPda);
    expect(cfg.quorumBps).to.eq(4000);
    expect(cfg.supportBps).to.eq(5000);
    expect(cfg.votingPeriod.toString()).to.eq("432000");
  });

  it("register_config rejects a payer that is not the trust authority", async () => {
    const trust = await createTestTrust(
      provider,
      trustProgram,
      "aeqi-governance-unauthorized-register-config",
    );
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trust.toBuffer()],
      program.programId,
    );
    await program.methods
      .init()
      .accountsPartial({
        trust,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const cfgId = new Uint8Array(32);
    cfgId[0] = 0x51;
    const [cfgPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_config"), trust.toBuffer(), Buffer.from(cfgId)],
      program.programId,
    );
    const payer = await fundKeypair(provider);

    await expectTxFail(
      () =>
        program.methods
          .registerConfig(Array.from(cfgId), {
            proposalThreshold: new anchor.BN(0),
            quorumBps: 4000,
            supportBps: 5000,
            votingPeriod: new anchor.BN(60),
            executionDelay: new anchor.BN(0),
            allowEarlyEnact: false,
          })
          .accountsPartial({
            trust,
            moduleState: moduleStatePda,
            governanceConfig: cfgPda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc(),
      /Unauthorized/,
    );
  });

  it("propose creates a Proposal PDA bound to the config", async () => {
    const tokenConfigId = new Uint8Array(32);
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xab;

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("gov_config"),
        fakeTrust.toBuffer(),
        Buffer.from(tokenConfigId),
      ],
      program.programId,
    );
    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), fakeTrust.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );

    const ipfsCid = new Uint8Array(64).fill(0x71); // 'q'

    await program.methods
      .propose(
        Array.from(proposalId),
        Array.from(tokenConfigId),
        Array.from(ipfsCid),
      )
      .accountsPartial({
        trust: fakeTrust,
        moduleState: modulePda,
        proposal: proposalPda,
        proposer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: cfgPda, isSigner: false, isWritable: false },
      ])
      .rpc();

    const p = await program.account.proposal.fetch(proposalPda);
    expect(p.proposer.toBase58()).to.eq(provider.wallet.publicKey.toBase58());
    expect(Buffer.from(p.proposalId).toString("hex")).to.eq(
      Buffer.from(proposalId).toString("hex"),
    );
    expect(p.executed).to.eq(false);
    expect(p.canceled).to.eq(false);
    expect(p.forVotes.toString()).to.eq("0");

    const m = await program.account.governanceModuleState.fetch(modulePda);
    expect(m.proposalCount.toString()).to.eq("1");
  });

  it("cast_vote rejects caller-supplied vote weights", async () => {
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xab; // same proposal as previous test

    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), fakeTrust.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );
    const [votePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        fakeTrust.toBuffer(),
        Buffer.from(proposalId),
        provider.wallet.publicKey.toBuffer(),
      ],
      program.programId,
    );

    await program.methods
      .castVote(1, new anchor.BN(1000))
      .accountsPartial({
        proposal: proposalPda,
        vote: votePda,
        voter: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc()
      .then(
        () => {
          throw new Error("expected generic vote rejection");
        },
        (e: any) => {
          expect(e.toString()).to.match(/GenericVotingDisabled/);
        },
      );

    const p = await program.account.proposal.fetch(proposalPda);
    expect(p.forVotes.toString()).to.eq("0");
    expect(p.againstVotes.toString()).to.eq("0");
    expect(p.abstainVotes.toString()).to.eq("0");

    const voteInfo = await provider.connection.getAccountInfo(votePda);
    expect(voteInfo).to.eq(null);
  });

  it("cast_vote_token rejects double-voting via PDA uniqueness", async () => {
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xd0;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xd0;
    proposalId[1] = 0x01;

    const fixture = await setupTokenVotingProposal({
      seed0: 0xd0,
      cfgId,
      proposalId,
      voteAmount: 1000,
    });

    let threw = false;
    try {
      await program.methods
        .castVoteToken(0)
        .accountsPartial({
          proposal: fixture.proposalPda,
          vote: fixture.votePda,
          voterTokenAccount: fixture.voterAta,
          mint: fixture.mintPda,
          voter: fixture.voter,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      // VoteRecord PDA already exists — init will fail
      expect(e.toString()).to.match(/already in use|custom program error/);
    }
    expect(threw).to.eq(true);
  });

  it("rejects propose when the config id does not match the chosen config", async () => {
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xec;

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_config"), fakeTrust.toBuffer(), Buffer.from(cfgId)],
      program.programId,
    );

    await program.methods
      .registerConfig(Array.from(cfgId), {
        proposalThreshold: new anchor.BN(0),
        quorumBps: 4000,
        supportBps: 5000,
        votingPeriod: new anchor.BN(60),
        executionDelay: new anchor.BN(0),
        allowEarlyEnact: false,
      })
      .accountsPartial({
        trust: fakeTrust,
        moduleState: modulePda,
        governanceConfig: cfgPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xac;
    const wrongConfigId = new Uint8Array(32);
    wrongConfigId[0] = 0xad;

    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), fakeTrust.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );

    let threw = false;
    try {
      await program.methods
        .propose(
          Array.from(proposalId),
          Array.from(wrongConfigId),
          Array.from(new Uint8Array(64)),
        )
        .accountsPartial({
          trust: fakeTrust,
          moduleState: modulePda,
          proposal: proposalPda,
          proposer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: cfgPda, isSigner: false, isWritable: false },
        ])
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/ConfigMismatch/);
    }
    expect(threw).to.eq(true);
  });

  it("rejects propose when no config remaining account is supplied", async () => {
    const tokenConfigId = new Uint8Array(32);
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xaa;
    proposalId[1] = 0x01;

    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), fakeTrust.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );

    let threw = false;
    try {
      await program.methods
        .propose(
          Array.from(proposalId),
          Array.from(tokenConfigId),
          Array.from(new Uint8Array(64)),
        )
        .accountsPartial({
          trust: fakeTrust,
          moduleState: modulePda,
          proposal: proposalPda,
          proposer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/ConfigMismatch/);
    }
    expect(threw).to.eq(true);
  });

  it("cast_vote_token rejects zero-balance voters", async () => {
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xd1;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xd1;
    proposalId[1] = 0x01;

    const fixture = await setupTokenVotingProposal({
      seed0: 0xd1,
      cfgId,
      proposalId,
      voteAmount: 0,
      castVote: false,
    });

    let threw = false;
    try {
      await program.methods
        .castVoteToken(1)
        .accountsPartial({
          proposal: fixture.proposalPda,
          vote: fixture.votePda,
          voterTokenAccount: fixture.voterAta,
          mint: fixture.mintPda,
          voter: fixture.voter,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/ZeroWeight/);
    }
    expect(threw).to.eq(true);
  });

  it("execute_proposal advances state when quorum + support met (early enact)", async () => {
    const cfgId = new Uint8Array(32);
    const propId = new Uint8Array(32);
    propId[0] = 0xee;
    propId[1] = 0xee;
    const fixture = await setupTokenVotingProposal({
      seed0: 0xe0,
      cfgId,
      proposalId: propId,
      voteAmount: 1000,
    });

    // Total vote supply = 1000. Quorum: 40% = 400. We have 1000 participating.
    // Support: 100% For of 1000 decisive. Both thresholds met.
    await program.methods
      .executeProposal()
      .accountsPartial({
        proposal: fixture.proposalPda,
        executor: provider.wallet.publicKey,
      })
      .remainingAccounts([
        { pubkey: fixture.cfgPda, isSigner: false, isWritable: false },
        { pubkey: fixture.mintPda, isSigner: false, isWritable: false },
      ])
      .rpc();

    const p = await program.account.proposal.fetch(fixture.proposalPda);
    expect(p.executed).to.eq(true);
    expect(p.succeededAt.toString()).to.not.eq("0");
  });

  it("execute_proposal rejects when quorum not met", async () => {
    const cfgId = new Uint8Array(32);
    const propId = new Uint8Array(32);
    propId[0] = 0xed;
    propId[1] = 0xed;
    const fixture = await setupTokenVotingProposal({
      seed0: 0xe1,
      cfgId,
      proposalId: propId,
      voteAmount: 100,
      extraMintAmount: 999_900,
    });

    // Mint supply = 1_000_000 → 40% quorum = 400_000. 100 participating ≪ 400_000.
    let threw = false;
    try {
      await program.methods
        .executeProposal()
        .accountsPartial({
          proposal: fixture.proposalPda,
          executor: provider.wallet.publicKey,
        })
        .remainingAccounts([
          { pubkey: fixture.cfgPda, isSigner: false, isWritable: false },
          { pubkey: fixture.mintPda, isSigner: false, isWritable: false },
        ])
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/QuorumNotMet/);
    }
    expect(threw).to.eq(true);
  });

  it("execute_proposal rejects when the config account does not match the proposal", async () => {
    const cfgId = new Uint8Array(32);
    const propId = new Uint8Array(32);
    propId[0] = 0xaf;
    const fixture = await setupTokenVotingProposal({
      seed0: 0xe2,
      cfgId,
      proposalId: propId,
      voteAmount: 1000,
    });

    const wrongCfgPda = anchor.web3.SystemProgram.programId;

    let threw = false;
    try {
      await program.methods
        .executeProposal()
        .accountsPartial({
          proposal: fixture.proposalPda,
          executor: provider.wallet.publicKey,
        })
        .remainingAccounts([
          { pubkey: wrongCfgPda, isSigner: false, isWritable: false },
        ])
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/ConfigMismatch/);
    }
    expect(threw).to.eq(true);
  });

  it("execute_proposal rejects when no config remaining account is supplied", async () => {
    const cfgId = new Uint8Array(32);
    const propId = new Uint8Array(32);
    propId[0] = 0xb1;
    propId[1] = 0x01;
    const fixture = await setupTokenVotingProposal({
      seed0: 0xe3,
      cfgId,
      proposalId: propId,
      voteAmount: 1000,
    });

    let threw = false;
    try {
      await program.methods
        .executeProposal()
        .accountsPartial({
          proposal: fixture.proposalPda,
          executor: provider.wallet.publicKey,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/ConfigMismatch/);
    }
    expect(threw).to.eq(true);
  });

  it("execute_proposal rejects when the vote supply account is missing", async () => {
    const cfgId = new Uint8Array(32);
    const propId = new Uint8Array(32);
    propId[0] = 0xb2;
    propId[1] = 0x01;
    const fixture = await setupTokenVotingProposal({
      seed0: 0xe4,
      cfgId,
      proposalId: propId,
      voteAmount: 1000,
    });

    let threw = false;
    try {
      await program.methods
        .executeProposal()
        .accountsPartial({
          proposal: fixture.proposalPda,
          executor: provider.wallet.publicKey,
        })
        .remainingAccounts([
          { pubkey: fixture.cfgPda, isSigner: false, isWritable: false },
        ])
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/MissingVoteSupplyAccount/);
    }
    expect(threw).to.eq(true);
  });

  it("cast_vote_role reads weight from RoleVoteCheckpoint owned by aeqi_role", async () => {
    // Need an actual RoleVoteCheckpoint PDA — set one up by spinning up
    // aeqi_role on a fresh trust, creating + assigning a role.
    const role = anchor.workspace.aeqiRole as anchor.Program<
      import("../target/types/aeqi_role").AeqiRole
    >;

    const trustR = await createTrust(0xee);
    const directorTypeId = new Uint8Array(32);
    directorTypeId[0] = 0xc7;

    // 1. init aeqi_role module on the trust
    const [roleModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role_module"), trustR.toBuffer()],
      role.programId,
    );
    await role.methods
      .init()
      .accountsPartial({
        trust: trustR,
        moduleState: roleModuleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // 2. create the director role type
    const [rtPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("role_type"),
        trustR.toBuffer(),
        Buffer.from(directorTypeId),
      ],
      role.programId,
    );
    await role.methods
      .createRoleType(Array.from(directorTypeId), 0, {
        vesting: false,
        vestingCliff: new anchor.BN(0),
        vestingDuration: new anchor.BN(0),
        fdv: false,
        fdvStart: new anchor.BN(0),
        fdvEnd: new anchor.BN(0),
        probationaryPeriod: new anchor.BN(0),
        severancePeriod: new anchor.BN(0),
        contribution: false,
      })
      .accountsPartial({
        trust: trustR,
        roleType: rtPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // 3. create a role + assign to provider.wallet — auto-self-delegates → checkpoint count = 1
    const roleId = new Uint8Array(32);
    roleId[0] = 0xc7;
    roleId[1] = 0x01;
    const [rolePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), trustR.toBuffer(), Buffer.from(roleId)],
      role.programId,
    );
    await role.methods
      .createRole(
        Array.from(roleId),
        Array.from(directorTypeId),
        null,
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        trust: trustR,
        roleType: rtPda,
        role: rolePda,
        callerRole: null,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const voter = provider.wallet.publicKey;
    const [checkpointPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("role_ckpt"),
        trustR.toBuffer(),
        Buffer.from(directorTypeId),
        voter.toBuffer(),
      ],
      role.programId,
    );
    await role.methods
      .assignRole(voter)
      .accountsPartial({
        role: rolePda,
        roleType: rtPda,
        trust: trustR,
        callerRole: null,
        checkpoint: checkpointPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // 4. governance setup — config_id = directorTypeId (per-role multisig mode)
    const [govModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trustR.toBuffer()],
      program.programId,
    );
    await program.methods
      .init()
      .accountsPartial({
        trust: trustR,
        moduleState: govModulePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("gov_config"),
        trustR.toBuffer(),
        Buffer.from(directorTypeId),
      ],
      program.programId,
    );
    await program.methods
      .registerConfig(Array.from(directorTypeId), {
        proposalThreshold: new anchor.BN(0),
        quorumBps: 4000,
        supportBps: 5000,
        votingPeriod: new anchor.BN(60),
        executionDelay: new anchor.BN(0),
        allowEarlyEnact: true,
      })
      .accountsPartial({
        trust: trustR,
        moduleState: govModulePda,
        governanceConfig: cfgPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xc7;
    proposalId[1] = 0xff;
    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), trustR.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );
    await program.methods
      .propose(
        Array.from(proposalId),
        Array.from(directorTypeId),
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        trust: trustR,
        moduleState: govModulePda,
        proposal: proposalPda,
        proposer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: cfgPda, isSigner: false, isWritable: false },
      ])
      .rpc();

    // 5. cast_vote_role — voter_checkpoint = the role-checkpoint PDA we just created
    const [votePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        trustR.toBuffer(),
        Buffer.from(proposalId),
        voter.toBuffer(),
      ],
      program.programId,
    );

    await program.methods
      .castVoteRole(1) // For
      .accountsPartial({
        proposal: proposalPda,
        vote: votePda,
        voterCheckpoint: checkpointPda,
        voter,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const p = await program.account.proposal.fetch(proposalPda);
    expect(p.forVotes.toString()).to.eq("1"); // 1 director role held by voter

    const v = await program.account.voteRecord.fetch(votePda);
    expect(v.weight.toString()).to.eq("1");
  });

  it("cast_vote_token reads weight from real Token-2022 balance (canonical mint)", async () => {
    // Full token-mode flow: aeqi_token.create_mint gives the canonical mint
    // at PDA [b"mint", trust]; aeqi_token.mint_tokens issues 1500 to voter;
    // governance.cast_vote_token reads voter's balance + validates the mint
    // is the canonical PDA via seeds::program = AEQI_TOKEN_ID.
    const aeqiToken = anchor.workspace.aeqiToken as anchor.Program<AeqiToken>;
    const trustId = new Uint8Array(32);
    trustId[0] = 0xf0;
    trustId[1] = 0x01;
    const [trustV] = PublicKey.findProgramAddressSync(
      [Buffer.from("trust"), Buffer.from(trustId)],
      trustProgram.programId,
    );
    await trustProgram.methods
      .initialize(Array.from(trustId))
      .accountsPartial({
        trust: trustV,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Token module setup
    const [tokenModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_module"), trustV.toBuffer()],
      aeqiToken.programId,
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority"), trustV.toBuffer()],
      aeqiToken.programId,
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), trustV.toBuffer()],
      aeqiToken.programId,
    );

    await aeqiToken.methods
      .init()
      .accountsPartial({
        trust: trustV,
        moduleState: tokenModuleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(trustV, tokenModuleStatePda);

    await aeqiToken.methods
      .createMint(9)
      .accountsPartial({
        trust: trustV,
        moduleState: tokenModuleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const voter = provider.wallet.publicKey;
    const voterAta = getAssociatedTokenAddressSync(
      mintPda,
      voter,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          voter,
          voterAta,
          voter,
          mintPda,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      ),
    );
    await aeqiToken.methods
      .mintTokens(new anchor.BN(1500))
      .accountsPartial({
        trust: trustV,
        moduleState: tokenModuleStatePda,
        mintAuthority: mintAuthorityPda,
        mint: mintPda,
        recipientTa: voterAta,
        authority: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Governance setup
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trustV.toBuffer()],
      program.programId,
    );
    await program.methods
      .init()
      .accountsPartial({
        trust: trustV,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const tokenCfgId = new Uint8Array(32);
    const [cfgPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_config"), trustV.toBuffer(), Buffer.from(tokenCfgId)],
      program.programId,
    );
    await program.methods
      .registerConfig(Array.from(tokenCfgId), {
        proposalThreshold: new anchor.BN(0),
        quorumBps: 4000,
        supportBps: 5000,
        votingPeriod: new anchor.BN(60),
        executionDelay: new anchor.BN(0),
        allowEarlyEnact: true,
      })
      .accountsPartial({
        trust: trustV,
        moduleState: moduleStatePda,
        governanceConfig: cfgPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xb1;
    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), trustV.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );
    await program.methods
      .propose(
        Array.from(proposalId),
        Array.from(tokenCfgId),
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        trust: trustV,
        moduleState: moduleStatePda,
        proposal: proposalPda,
        proposer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: cfgPda, isSigner: false, isWritable: false },
      ])
      .rpc();

    const [votePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        trustV.toBuffer(),
        Buffer.from(proposalId),
        voter.toBuffer(),
      ],
      program.programId,
    );

    await program.methods
      .castVoteToken(1) // For
      .accountsPartial({
        proposal: proposalPda,
        vote: votePda,
        voterTokenAccount: voterAta,
        mint: mintPda,
        voter,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const p = await program.account.proposal.fetch(proposalPda);
    expect(p.forVotes.toString()).to.eq("1500");

    const v = await program.account.voteRecord.fetch(votePda);
    expect(v.weight.toString()).to.eq("1500");
    expect(v.choice).to.eq(1);
  });

  it("cast_vote_role rejects checkpoints created after proposal.snapshot_slot", async () => {
    // ae-003 regression: closes the role-governance checkpoint
    // vulnerability documented in idea
    // design/aeqi-governance-proposal-start-snapshots. Sequence:
    //   1. Set up a role, assign to voter (checkpoint at slot S1 with count=1).
    //   2. Create proposal (snapshot_slot = S2, S2 >= S1).
    //   3. Wait until the cluster moves PAST S2.
    //   4. Create a second role of the same type, assign to the same voter —
    //      this bumps the SAME checkpoint PDA (count=2) at slot S3 > S2.
    //   5. cast_vote_role must reject with CheckpointAfterSnapshot.
    const role = anchor.workspace.aeqiRole as anchor.Program<
      import("../target/types/aeqi_role").AeqiRole
    >;

    const trustR = await createTrust(0xee, 0x03);
    const directorTypeId = new Uint8Array(32);
    directorTypeId[0] = 0xc8;

    const [roleModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role_module"), trustR.toBuffer()],
      role.programId,
    );
    await role.methods
      .init()
      .accountsPartial({
        trust: trustR,
        moduleState: roleModuleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const [rtPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("role_type"),
        trustR.toBuffer(),
        Buffer.from(directorTypeId),
      ],
      role.programId,
    );
    await role.methods
      .createRoleType(Array.from(directorTypeId), 0, {
        vesting: false,
        vestingCliff: new anchor.BN(0),
        vestingDuration: new anchor.BN(0),
        fdv: false,
        fdvStart: new anchor.BN(0),
        fdvEnd: new anchor.BN(0),
        probationaryPeriod: new anchor.BN(0),
        severancePeriod: new anchor.BN(0),
        contribution: false,
      })
      .accountsPartial({
        trust: trustR,
        roleType: rtPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Role 1: voter takes the role-type's only seat (role_count = 1 path).
    const roleId1 = new Uint8Array(32);
    roleId1[0] = 0xc8;
    roleId1[1] = 0x01;
    const [rolePda1] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), trustR.toBuffer(), Buffer.from(roleId1)],
      role.programId,
    );
    await role.methods
      .createRole(
        Array.from(roleId1),
        Array.from(directorTypeId),
        null,
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        trust: trustR,
        roleType: rtPda,
        role: rolePda1,
        callerRole: null,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const voter = provider.wallet.publicKey;
    const [checkpointPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("role_ckpt"),
        trustR.toBuffer(),
        Buffer.from(directorTypeId),
        voter.toBuffer(),
      ],
      role.programId,
    );
    await role.methods
      .assignRole(voter)
      .accountsPartial({
        role: rolePda1,
        roleType: rtPda,
        trust: trustR,
        callerRole: null,
        checkpoint: checkpointPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Governance setup — config_id = directorTypeId.
    const [govModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), trustR.toBuffer()],
      program.programId,
    );
    await program.methods
      .init()
      .accountsPartial({
        trust: trustR,
        moduleState: govModulePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("gov_config"),
        trustR.toBuffer(),
        Buffer.from(directorTypeId),
      ],
      program.programId,
    );
    await program.methods
      .registerConfig(Array.from(directorTypeId), {
        proposalThreshold: new anchor.BN(0),
        quorumBps: 4000,
        supportBps: 5000,
        votingPeriod: new anchor.BN(60),
        executionDelay: new anchor.BN(0),
        allowEarlyEnact: true,
      })
      .accountsPartial({
        trust: trustR,
        moduleState: govModulePda,
        governanceConfig: cfgPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xc8;
    proposalId[1] = 0x03;
    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), trustR.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );
    await program.methods
      .propose(
        Array.from(proposalId),
        Array.from(directorTypeId),
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        trust: trustR,
        moduleState: govModulePda,
        proposal: proposalPda,
        proposer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: cfgPda, isSigner: false, isWritable: false },
      ])
      .rpc();

    const proposalAfter = await program.account.proposal.fetch(proposalPda);
    const snapshotSlot = BigInt(proposalAfter.snapshotSlot.toString());

    // Wait for the cluster to advance past snapshot_slot so the next
    // assign_role lands on a strictly newer slot. Localnet runs ~2.5 slots/s.
    while (
      BigInt(await provider.connection.getSlot("processed")) <= snapshotSlot
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Role 2: same role type, second seat. createRole bumps role_count to 2,
    // so a "no caller_role" path is NOT permitted by gate_role_assignment
    // (which requires role_count == 1 for the implicit-authority branch).
    // Use the existing role as caller_role: the voter, who occupies role1,
    // is its own authority via require_keys_eq!(caller_role.account, payer).
    const roleId2 = new Uint8Array(32);
    roleId2[0] = 0xc8;
    roleId2[1] = 0x02;
    const [rolePda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), trustR.toBuffer(), Buffer.from(roleId2)],
      role.programId,
    );
    await role.methods
      .createRole(
        Array.from(roleId2),
        Array.from(directorTypeId),
        Array.from(roleId1), // parent_role_id = role1 (the voter holds it)
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        trust: trustR,
        roleType: rtPda,
        role: rolePda2,
        callerRole: rolePda1,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await role.methods
      .assignRole(voter)
      .accountsPartial({
        role: rolePda2,
        roleType: rtPda,
        trust: trustR,
        callerRole: rolePda1,
        checkpoint: checkpointPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Sanity-check: checkpoint slot now exceeds proposal.snapshot_slot, and
    // count grew to 2.
    const ckptInfo = await provider.connection.getAccountInfo(checkpointPda);
    expect(ckptInfo, "checkpoint must exist").to.not.eq(null);
    // RoleVoteCheckpoint layout: [8 disc][32 pubkey][32 role_type_id][8 slot u64][8 count u64][1 bump]
    const ckptSlot = ckptInfo!.data.readBigUInt64LE(8 + 32 + 32);
    const ckptCount = ckptInfo!.data.readBigUInt64LE(8 + 32 + 32 + 8);
    expect(ckptCount.toString()).to.eq("2");
    expect(ckptSlot > snapshotSlot).to.eq(
      true,
      `expected checkpoint slot ${ckptSlot} > snapshot_slot ${snapshotSlot}`,
    );

    // The actual regression assertion.
    const [votePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        trustR.toBuffer(),
        Buffer.from(proposalId),
        voter.toBuffer(),
      ],
      program.programId,
    );

    let threw = false;
    try {
      await program.methods
        .castVoteRole(1)
        .accountsPartial({
          proposal: proposalPda,
          vote: votePda,
          voterCheckpoint: checkpointPda,
          voter,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/CheckpointAfterSnapshot/);
    }
    expect(threw, "cast_vote_role must reject stale-snapshot checkpoint").to.eq(
      true,
    );

    // No VoteRecord should have been created.
    const voteInfo = await provider.connection.getAccountInfo(votePda);
    expect(voteInfo).to.eq(null);
  });

  it("rejects register_config with invalid bps", async () => {
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xff; // distinct from previous tests' 0xee/0xed

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_config"), fakeTrust.toBuffer(), Buffer.from(cfgId)],
      program.programId,
    );

    let threw = false;
    try {
      await program.methods
        .registerConfig(Array.from(cfgId), {
          proposalThreshold: new anchor.BN(0),
          quorumBps: 12000, // > 10000 invalid
          supportBps: 5000,
          votingPeriod: new anchor.BN(86400),
          executionDelay: new anchor.BN(0),
          allowEarlyEnact: false,
        })
        .accountsPartial({
          trust: fakeTrust,
          moduleState: modulePda,
          governanceConfig: cfgPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/InvalidBpsValue/);
    }
    expect(threw).to.eq(true);
  });
});
