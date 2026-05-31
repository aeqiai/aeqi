import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AeqiBudget } from "../target/types/aeqi_budget";
import { AeqiRole } from "../target/types/aeqi_role";
import { AeqiCompany } from "../target/types/aeqi_company";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { createCompany, expectTxFail, fundKeypair } from "./support";

describe("aeqi_budget", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.aeqiBudget as Program<AeqiBudget>;
  const roleProgram = anchor.workspace.aeqiRole as Program<AeqiRole>;
  const trustProgram = anchor.workspace.aeqiCompany as Program<AeqiCompany>;

  let fakeCompany: PublicKey;
  let modulePda: PublicKey;
  let targetRolePda: PublicKey;

  const targetRoleTypeId = new Uint8Array(32);
  targetRoleTypeId[0] = 0x65;
  const targetRoleId = new Uint8Array(32);
  targetRoleId[0] = 0x65;

  before(async () => {
    fakeCompany = await createCompany(provider, trustProgram, "aeqi-budget");

    [modulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("budget_module"), fakeCompany.toBuffer()],
      program.programId,
    );
    const [roleModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role_module"), fakeCompany.toBuffer()],
      roleProgram.programId,
    );
    const [roleTypePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("role_type"),
        fakeCompany.toBuffer(),
        Buffer.from(targetRoleTypeId),
      ],
      roleProgram.programId,
    );
    [targetRolePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), fakeCompany.toBuffer(), Buffer.from(targetRoleId)],
      roleProgram.programId,
    );
    const [checkpointPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("role_ckpt"),
        fakeCompany.toBuffer(),
        Buffer.from(targetRoleTypeId),
        provider.wallet.publicKey.toBuffer(),
      ],
      roleProgram.programId,
    );

    await roleProgram.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: roleModulePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await roleProgram.methods
      .createRoleType(Array.from(targetRoleTypeId), 0, {
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
        company: fakeCompany,
        roleType: roleTypePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await roleProgram.methods
      .createRole(
        Array.from(targetRoleId),
        Array.from(targetRoleTypeId),
        null,
        Array.from(new Uint8Array(64)),
      )
      .accountsPartial({
        company: fakeCompany,
        roleType: roleTypePda,
        role: targetRolePda,
        callerRole: null,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await roleProgram.methods
      .assignRole(provider.wallet.publicKey)
      .accountsPartial({
        role: targetRolePda,
        roleType: roleTypePda,
        company: fakeCompany,
        callerRole: null,
        checkpoint: checkpointPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  });

  it("init creates the budget module state", async () => {
    await program.methods
      .init()
      .accountsPartial({
        company: fakeCompany,
        moduleState: modulePda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const m = await program.account.budgetModuleState.fetch(modulePda);
    expect(m.company.toBase58()).to.eq(fakeCompany.toBase58());
    expect(m.budgetCount.toString()).to.eq("0");
  });

  it("init rejects a payer that is not the company authority", async () => {
    const company = await createCompany(
      provider,
      trustProgram,
      "aeqi-budget-unauthorized-init",
    );
    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("budget_module"), company.toBuffer()],
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

  it("create_budget + record_spend tracks allocation against cap", async () => {
    const budgetId = new Uint8Array(32);
    budgetId[0] = 0xb1;

    const [budgetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("budget"), fakeCompany.toBuffer(), Buffer.from(budgetId)],
      program.programId,
    );

    await program.methods
      .createBudget(
        Array.from(budgetId),
        Array.from(targetRoleId),
        new anchor.BN(50_000),
        new anchor.BN(0), // no expiry
        null, // no parent
      )
      .accountsPartial({
        company: fakeCompany,
        moduleState: modulePda,
        budget: budgetPda,
        grantor: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    let b = await program.account.budget.fetch(budgetPda);
    expect(b.amount.toString()).to.eq("50000");
    expect(b.spent.toString()).to.eq("0");
    expect(b.frozen).to.eq(false);

    // Record two spends: 10000 + 25000 = 35000
    await program.methods
      .recordSpend(new anchor.BN(10_000))
      .accountsPartial({
        budget: budgetPda,
        spenderRole: targetRolePda,
        spender: provider.wallet.publicKey,
      })
      .rpc();
    await program.methods
      .recordSpend(new anchor.BN(25_000))
      .accountsPartial({
        budget: budgetPda,
        spenderRole: targetRolePda,
        spender: provider.wallet.publicKey,
      })
      .rpc();

    b = await program.account.budget.fetch(budgetPda);
    expect(b.spent.toString()).to.eq("35000");

    // Try to overspend (35000 + 20000 > 50000 cap)
    let threw = false;
    try {
      await program.methods
        .recordSpend(new anchor.BN(20_000))
        .accountsPartial({
          budget: budgetPda,
          spenderRole: targetRolePda,
          spender: provider.wallet.publicKey,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/ExceedsAllocation/);
    }
    expect(threw).to.eq(true);
  });

  it("rejects record_spend from a signer that does not hold the target role", async () => {
    const budgetId = new Uint8Array(32);
    budgetId[0] = 0xb4;

    const [budgetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("budget"), fakeCompany.toBuffer(), Buffer.from(budgetId)],
      program.programId,
    );

    await program.methods
      .createBudget(
        Array.from(budgetId),
        Array.from(targetRoleId),
        new anchor.BN(1000),
        new anchor.BN(0),
        null,
      )
      .accountsPartial({
        company: fakeCompany,
        moduleState: modulePda,
        budget: budgetPda,
        grantor: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const attacker = await fundKeypair(provider);

    await expectTxFail(
      async () =>
        program.methods
          .recordSpend(new anchor.BN(100))
          .accountsPartial({
            budget: budgetPda,
            spenderRole: targetRolePda,
            spender: attacker.publicKey,
          })
          .signers([attacker])
          .rpc(),
      /Unauthorized/,
    );
  });

  it("freeze blocks further spends", async () => {
    const budgetId = new Uint8Array(32);
    budgetId[0] = 0xb2;

    const [budgetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("budget"), fakeCompany.toBuffer(), Buffer.from(budgetId)],
      program.programId,
    );

    await program.methods
      .createBudget(
        Array.from(budgetId),
        Array.from(targetRoleId),
        new anchor.BN(1000),
        new anchor.BN(0),
        null,
      )
      .accountsPartial({
        company: fakeCompany,
        moduleState: modulePda,
        budget: budgetPda,
        grantor: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .freeze()
      .accountsPartial({
        budget: budgetPda,
        grantor: provider.wallet.publicKey,
      })
      .rpc();

    let threw = false;
    try {
      await program.methods
        .recordSpend(new anchor.BN(100))
        .accountsPartial({
          budget: budgetPda,
          spenderRole: targetRolePda,
          spender: provider.wallet.publicKey,
        })
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/BudgetFrozen/);
    }
    expect(threw).to.eq(true);

    // Unfreeze + spend works
    await program.methods
      .unfreeze()
      .accountsPartial({
        budget: budgetPda,
        grantor: provider.wallet.publicKey,
      })
      .rpc();

    await program.methods
      .recordSpend(new anchor.BN(100))
      .accountsPartial({
        budget: budgetPda,
        spenderRole: targetRolePda,
        spender: provider.wallet.publicKey,
      })
      .rpc();

    const b = await program.account.budget.fetch(budgetPda);
    expect(b.spent.toString()).to.eq("100");
  });

  it("rejects freeze from a non-grantor", async () => {
    const budgetId = new Uint8Array(32);
    budgetId[0] = 0xb3;

    const [budgetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("budget"), fakeCompany.toBuffer(), Buffer.from(budgetId)],
      program.programId,
    );

    await program.methods
      .createBudget(
        Array.from(budgetId),
        Array.from(new Uint8Array(32).fill(0x66)),
        new anchor.BN(1000),
        new anchor.BN(0),
        null,
      )
      .accountsPartial({
        company: fakeCompany,
        moduleState: modulePda,
        budget: budgetPda,
        grantor: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const attacker = await fundKeypair(provider);

    await expectTxFail(
      async () =>
        program.methods
          .freeze()
          .accountsPartial({
            budget: budgetPda,
            grantor: attacker.publicKey,
          })
          .signers([attacker])
          .rpc(),
      /Unauthorized/,
    );
  });
});
