import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AeqiGovernance } from "../target/types/aeqi_governance";
import { AeqiToken } from "../target/types/aeqi_token";
import { AeqiCompany } from "../target/types/aeqi_company";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  createCompany as createTestCompany,
  expectTxFail,
  fundKeypair,
  SUITE_SEED_TAIL,
} from "./support";
import {
  buildMerkleTree,
  merkleProof,
  tokenVoteLeaf,
  verifyMerkleProof,
} from "./helpers/merkle";

describe("aeqi_governance", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.aeqiGovernance as Program<AeqiGovernance>;
  const trustProgram = anchor.workspace.aeqiCompany as Program<AeqiCompany>;
  const tokenProgram = anchor.workspace.aeqiToken as Program<AeqiToken>;

  let fakeCompany: PublicKey;
  let modulePda: PublicKey;

  before(async () => {
    fakeCompany = await createTestCompany(
      provider,
      trustProgram,
      "aeqi-governance",
    );

    [modulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), fakeCompany.toBuffer()],
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
        company: trustPda,
        config: tokenBytesConfigPda,
        sourceModule: null,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await tokenProgram.methods
      .finalize()
      .accountsPartial({
        company: trustPda,
        moduleState: tokenModuleStatePda,
        bytesConfig: tokenBytesConfigPda,
      })
      .rpc();
  }

  async function createCompany(seed0: number, seed1 = 0) {
    const companyId = new Uint8Array(32);
    companyId[0] = seed0;
    companyId[1] = seed1;
    // Fill bytes 2..32 with the per-invocation suite tail so this fixture
    // produces a fresh company PDA on every mocha run (ae-041). Within a
    // single invocation the tail is constant, so different (seed0, seed1)
    // pairs still yield distinct PDAs as before.
    companyId.set(SUITE_SEED_TAIL, 2);
    const [trustPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("company"), Buffer.from(companyId)],
      trustProgram.programId,
    );

    await trustProgram.methods
      .initialize(Array.from(companyId))
      .accountsPartial({
        company: trustPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    return trustPda;
  }

  // Wait until the cluster has advanced past `proposal.snapshotSlot`
  // (the on-chain commit gate requires current_slot > snapshot_slot).
  // Localnet runs at ~2.5 slots/s, so this typically returns inside a
  // single poll.
  async function waitPastSnapshotSlot(proposalPda: PublicKey) {
    const p = await program.account.proposal.fetch(proposalPda);
    const target = BigInt(p.snapshotSlot.toString());
    while (BigInt(await provider.connection.getSlot("processed")) <= target) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
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
    /**
     * Override the Merkle tree contributors. When omitted, the tree
     * contains just the primary voter at `voteAmount` (the simplest
     * happy-path snapshot). Negative tests can pass a tree that
     * doesn't include the voter to assert InvalidMerkleProof, or
     * include them with a different balance to assert the same.
     */
    snapshotEntries?: { holder: PublicKey; balance: bigint }[];
    /** Skip the commit_snapshot_root call entirely — for tests that
     * want to assert SnapshotNotCommitted. */
    skipSnapshotCommit?: boolean;
  }) {
    const trustPda = await createCompany(args.seed0, args.seed1 ?? 0);

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
        company: trustPda,
        moduleState: tokenModuleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(trustPda, tokenModuleStatePda);

    await tokenProgram.methods
      .createMint(9)
      .accountsPartial({
        company: trustPda,
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
          company: trustPda,
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
          company: trustPda,
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
        company: trustPda,
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
        company: trustPda,
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
        company: trustPda,
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

    // Build the Merkle snapshot. Default tree = just the voter at
    // voteAmount; callers can pass `snapshotEntries` to model multi-
    // holder snapshots or forged-balance scenarios.
    const snapshotEntries = args.snapshotEntries ?? [
      { holder: voter, balance: BigInt(args.voteAmount) },
    ];
    const tree = buildMerkleTree(snapshotEntries);
    const totalSupply = snapshotEntries.reduce((acc, e) => acc + e.balance, 0n);

    if (!(args.skipSnapshotCommit ?? false)) {
      // commit_snapshot_root requires current_slot > proposal.snapshot_slot.
      await waitPastSnapshotSlot(proposalPda);
      await program.methods
        .commitSnapshotRoot(
          Array.from(tree.root),
          new anchor.BN(totalSupply.toString()),
        )
        .accountsPartial({
          proposal: proposalPda,
          committer: provider.wallet.publicKey,
        })
        .rpc();
    }

    if (args.castVote ?? true) {
      const proof = merkleProof(tree, voter);
      await program.methods
        .castVoteToken(
          1,
          new anchor.BN(args.voteAmount),
          proof.map((p) => Array.from(p)),
        )
        .accountsPartial({
          proposal: proposalPda,
          vote: votePda,
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
      tree,
      totalSupply,
    };
  }

  it("init creates governance module state", async () => {
    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: modulePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const m = await program.account.governanceModuleState.fetch(modulePda);
    expect(m.company.toBase58()).to.eq(fakeCompany.toBase58());
    expect(m.proposalCount.toString()).to.eq("0");
    expect(m.configCount).to.eq(0);
  });

  it("init rejects a payer that is not the company authority", async () => {
    const company = await createTestCompany(
      provider,
      trustProgram,
      "aeqi-governance-unauthorized-init",
    );
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), company.toBuffer()],
      program.programId,
    );
    const payer = await fundKeypair(provider);

    await expectTxFail(
      () =>
        program.methods
          .init()
          .accountsPartial({
            company,
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
        fakeCompany.toBuffer(),
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
        company: fakeCompany,
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

  it("register_config rejects a payer that is not the company authority", async () => {
    const company = await createTestCompany(
      provider,
      trustProgram,
      "aeqi-governance-unauthorized-register-config",
    );
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_module"), company.toBuffer()],
      program.programId,
    );
    await program.methods
      .init()
      .accountsPartial({
        company,
        moduleState: moduleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const cfgId = new Uint8Array(32);
    cfgId[0] = 0x51;
    const [cfgPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gov_config"), company.toBuffer(), Buffer.from(cfgId)],
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
            company,
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
        fakeCompany.toBuffer(),
        Buffer.from(tokenConfigId),
      ],
      program.programId,
    );
    const [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), fakeCompany.toBuffer(), Buffer.from(proposalId)],
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
        company: fakeCompany,
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
      [Buffer.from("proposal"), fakeCompany.toBuffer(), Buffer.from(proposalId)],
      program.programId,
    );
    const [votePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        fakeCompany.toBuffer(),
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

    const replayProof = merkleProof(fixture.tree, fixture.voter);
    let threw = false;
    try {
      await program.methods
        .castVoteToken(
          0,
          new anchor.BN(1000),
          replayProof.map((p) => Array.from(p)),
        )
        .accountsPartial({
          proposal: fixture.proposalPda,
          vote: fixture.votePda,
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
      [Buffer.from("gov_config"), fakeCompany.toBuffer(), Buffer.from(cfgId)],
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
        company: fakeCompany,
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
      [Buffer.from("proposal"), fakeCompany.toBuffer(), Buffer.from(proposalId)],
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
          company: fakeCompany,
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
      [Buffer.from("proposal"), fakeCompany.toBuffer(), Buffer.from(proposalId)],
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
          company: fakeCompany,
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

  it("cast_vote_token rejects zero-balance voters (claimed_balance=0)", async () => {
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xd1;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xd1;
    proposalId[1] = 0x01;

    // Snapshot a positive holder so commit_snapshot_root succeeds (the
    // zero-root path is its own error). voteAmount is irrelevant in the
    // skipped-cast branch.
    const fixture = await setupTokenVotingProposal({
      seed0: 0xd1,
      cfgId,
      proposalId,
      voteAmount: 1,
      castVote: false,
    });

    let threw = false;
    try {
      // Even a valid-looking proof (one not used by setup) with
      // claimed_balance=0 must bounce before the proof step.
      await program.methods
        .castVoteToken(1, new anchor.BN(0), [])
        .accountsPartial({
          proposal: fixture.proposalPda,
          vote: fixture.votePda,
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
    // aeqi_role on a fresh company, creating + assigning a role.
    const role = anchor.workspace.aeqiRole as anchor.Program<
      import("../target/types/aeqi_role").AeqiRole
    >;

    const trustR = await createCompany(0xee);
    const directorTypeId = new Uint8Array(32);
    directorTypeId[0] = 0xc7;

    // 1. init aeqi_role module on the company
    const [roleModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role_module"), trustR.toBuffer()],
      role.programId,
    );
    await role.methods
      .init()
      .accountsPartial({
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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

  it("cast_vote_token uses Merkle-proven snapshot balance from real Token-2022 mint", async () => {
    // ae-008: full token-mode flow that exercises the new
    // snapshot-root commitment path against a real Token-2022 mint.
    // aeqi_token.create_mint gives the canonical mint at PDA
    // [b"mint", company]; aeqi_token.mint_tokens issues 1500 to voter;
    // we snapshot that balance into a Merkle tree, commit the root,
    // then cast_vote_token attests claimed_balance=1500 via inclusion
    // proof — same semantics as before the bug fix but no longer
    // vulnerable to transfer-and-revote.
    const aeqiToken = anchor.workspace.aeqiToken as anchor.Program<AeqiToken>;
    const companyId = new Uint8Array(32);
    companyId[0] = 0xf0;
    companyId[1] = 0x01;
    // Rotate bytes 2..32 per mocha invocation (ae-041) so re-running
    // against a persistent validator doesn't collide on this fixture's
    // company PDA.
    companyId.set(SUITE_SEED_TAIL, 2);
    const [trustV] = PublicKey.findProgramAddressSync(
      [Buffer.from("company"), Buffer.from(companyId)],
      trustProgram.programId,
    );
    await trustProgram.methods
      .initialize(Array.from(companyId))
      .accountsPartial({
        company: trustV,
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
        company: trustV,
        moduleState: tokenModuleStatePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await finalizeTokenModule(trustV, tokenModuleStatePda);

    await aeqiToken.methods
      .createMint(9)
      .accountsPartial({
        company: trustV,
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
        company: trustV,
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
        company: trustV,
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
        company: trustV,
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
        company: trustV,
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

    // Build the snapshot tree from the real on-chain holder set: just
    // the voter at 1500. Wait past snapshot_slot, commit the root,
    // then cast the vote with the inclusion proof.
    const tree = buildMerkleTree([{ holder: voter, balance: 1500n }]);
    await waitPastSnapshotSlot(proposalPda);
    await program.methods
      .commitSnapshotRoot(Array.from(tree.root), new anchor.BN(1500))
      .accountsPartial({
        proposal: proposalPda,
        committer: provider.wallet.publicKey,
      })
      .rpc();

    const proof = merkleProof(tree, voter);
    // Sanity-check the proof off-chain before submitting — cheaper to
    // debug here than on-chain.
    expect(
      verifyMerkleProof(tokenVoteLeaf(voter, 1500n), proof, tree.root),
    ).to.eq(true);

    await program.methods
      .castVoteToken(
        1, // For
        new anchor.BN(1500),
        proof.map((p) => Array.from(p)),
      )
      .accountsPartial({
        proposal: proposalPda,
        vote: votePda,
        voter,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const p = await program.account.proposal.fetch(proposalPda);
    expect(p.forVotes.toString()).to.eq("1500");
    // Snapshot root + total supply are now persisted on the Proposal.
    expect(Buffer.from(p.snapshotRoot).toString("hex")).to.eq(
      Buffer.from(tree.root).toString("hex"),
    );
    expect(p.snapshotTotalSupply.toString()).to.eq("1500");

    const v = await program.account.voteRecord.fetch(votePda);
    expect(v.weight.toString()).to.eq("1500");
    expect(v.choice).to.eq(1);
  });

  it("cast_vote_token rejects forged claimed_balance (Merkle proof mismatch)", async () => {
    // ae-008: the attack the snapshot pattern closes. The voter's
    // real snapshotted balance is 100; they try to claim 1000 with
    // the proof they DO have. Leaf encoding (sha256(voter || balance))
    // means the forged claim hashes to a different leaf and the proof
    // can't reach the root.
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xf1;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xf1;
    proposalId[1] = 0x01;

    const fixture = await setupTokenVotingProposal({
      seed0: 0xf1,
      cfgId,
      proposalId,
      voteAmount: 100,
      castVote: false,
    });

    const proof = merkleProof(fixture.tree, fixture.voter);
    let threw = false;
    try {
      await program.methods
        .castVoteToken(
          1,
          new anchor.BN(1000), // forged — real balance was 100
          proof.map((p) => Array.from(p)),
        )
        .accountsPartial({
          proposal: fixture.proposalPda,
          vote: fixture.votePda,
          voter: fixture.voter,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/InvalidMerkleProof/);
    }
    expect(threw, "forged balance must be rejected").to.eq(true);

    // No VoteRecord, no for_votes tally bump.
    const p = await program.account.proposal.fetch(fixture.proposalPda);
    expect(p.forVotes.toString()).to.eq("0");
    const voteInfo = await provider.connection.getAccountInfo(fixture.votePda);
    expect(voteInfo).to.eq(null);
  });

  it("cast_vote_token rejects a proof from a tree the voter isn't in", async () => {
    // The snapshot commits a root over a tree that includes some
    // other holder. The voter is also a holder on-chain, but they
    // were NOT snapshotted — any proof they construct must fail.
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xf2;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xf2;
    proposalId[1] = 0x01;

    const otherHolder = Keypair.generate().publicKey;
    // Snapshot only `otherHolder`; the voter is absent.
    const fixture = await setupTokenVotingProposal({
      seed0: 0xf2,
      cfgId,
      proposalId,
      voteAmount: 250,
      castVote: false,
      snapshotEntries: [{ holder: otherHolder, balance: 500n }],
    });

    // Voter constructs a proof against a DIFFERENT tree (the one
    // where they're at 250) and submits it against the committed
    // root, which is a different root.
    const localTree = buildMerkleTree([
      { holder: fixture.voter, balance: 250n },
    ]);
    const forgedProof = merkleProof(localTree, fixture.voter);

    let threw = false;
    try {
      await program.methods
        .castVoteToken(
          1,
          new anchor.BN(250),
          forgedProof.map((p) => Array.from(p)),
        )
        .accountsPartial({
          proposal: fixture.proposalPda,
          vote: fixture.votePda,
          voter: fixture.voter,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/InvalidMerkleProof/);
    }
    expect(threw, "voter not in snapshot must be rejected").to.eq(true);
  });

  it("cast_vote_token rejects voting before snapshot_root is committed", async () => {
    // Skip commit_snapshot_root entirely; cast_vote_token must
    // refuse to score votes against the zero root.
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xf3;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xf3;
    proposalId[1] = 0x01;

    const fixture = await setupTokenVotingProposal({
      seed0: 0xf3,
      cfgId,
      proposalId,
      voteAmount: 500,
      castVote: false,
      skipSnapshotCommit: true,
    });

    const proof = merkleProof(fixture.tree, fixture.voter);
    let threw = false;
    try {
      await program.methods
        .castVoteToken(
          1,
          new anchor.BN(500),
          proof.map((p) => Array.from(p)),
        )
        .accountsPartial({
          proposal: fixture.proposalPda,
          vote: fixture.votePda,
          voter: fixture.voter,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/SnapshotNotCommitted/);
    }
    expect(threw, "pre-commit votes must be rejected").to.eq(true);
  });

  it("commit_snapshot_root is one-shot (second commit rejected)", async () => {
    // Idempotency-by-rejection: once the root is set, no caller can
    // overwrite it. Protects against late snapshotters racing with
    // each other on the same proposal.
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xf4;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xf4;
    proposalId[1] = 0x01;

    const fixture = await setupTokenVotingProposal({
      seed0: 0xf4,
      cfgId,
      proposalId,
      voteAmount: 100,
      castVote: false,
      // setupTokenVotingProposal already commits once.
    });

    // Different root attempt: still rejected.
    const otherTree = buildMerkleTree([
      { holder: Keypair.generate().publicKey, balance: 100n },
    ]);

    let threw = false;
    try {
      await program.methods
        .commitSnapshotRoot(Array.from(otherTree.root), new anchor.BN(100))
        .accountsPartial({
          proposal: fixture.proposalPda,
          committer: provider.wallet.publicKey,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/CommitRootMismatch/);
    }
    expect(threw, "second commit must be rejected").to.eq(true);
  });

  it("cast_vote_token tallies two voters independently from one Merkle tree", async () => {
    // Multi-voter happy path: two holders share a snapshot root.
    // Each constructs their own proof and casts independently. Both
    // votes land with the expected weights.
    const cfgId = new Uint8Array(32);
    cfgId[0] = 0xf5;
    const proposalId = new Uint8Array(32);
    proposalId[0] = 0xf5;
    proposalId[1] = 0x01;

    const voter1 = provider.wallet.publicKey;
    const voter2Kp = await fundKeypair(provider);
    const voter2 = voter2Kp.publicKey;

    // Snapshot a 2-voter tree (voter1: 300, voter2: 700, total 1000).
    const fixture = await setupTokenVotingProposal({
      seed0: 0xf5,
      cfgId,
      proposalId,
      voteAmount: 300,
      castVote: false,
      snapshotEntries: [
        { holder: voter1, balance: 300n },
        { holder: voter2, balance: 700n },
      ],
    });

    // Voter 1 votes FOR with weight 300.
    const proof1 = merkleProof(fixture.tree, voter1);
    await program.methods
      .castVoteToken(
        1,
        new anchor.BN(300),
        proof1.map((p) => Array.from(p)),
      )
      .accountsPartial({
        proposal: fixture.proposalPda,
        vote: fixture.votePda,
        voter: voter1,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Voter 2 votes AGAINST with weight 700.
    const [vote2Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        fixture.trustPda.toBuffer(),
        Buffer.from(proposalId),
        voter2.toBuffer(),
      ],
      program.programId,
    );
    const proof2 = merkleProof(fixture.tree, voter2);
    await program.methods
      .castVoteToken(
        0,
        new anchor.BN(700),
        proof2.map((p) => Array.from(p)),
      )
      .accountsPartial({
        proposal: fixture.proposalPda,
        vote: vote2Pda,
        voter: voter2,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([voter2Kp])
      .rpc();

    const p = await program.account.proposal.fetch(fixture.proposalPda);
    expect(p.forVotes.toString()).to.eq("300");
    expect(p.againstVotes.toString()).to.eq("700");
    expect(p.snapshotTotalSupply.toString()).to.eq("1000");
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

    const trustR = await createCompany(0xee, 0x03);
    const directorTypeId = new Uint8Array(32);
    directorTypeId[0] = 0xc8;

    const [roleModuleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role_module"), trustR.toBuffer()],
      role.programId,
    );
    await role.methods
      .init()
      .accountsPartial({
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
        company: trustR,
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
      [Buffer.from("gov_config"), fakeCompany.toBuffer(), Buffer.from(cfgId)],
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
          company: fakeCompany,
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
