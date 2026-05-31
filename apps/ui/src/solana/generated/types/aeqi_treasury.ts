/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_treasury.json`.
 */
export type AeqiTreasury = {
  "address": "2KBH4dhAM8fvix5sB44f55Hy6mE4HgeMMbm3htZTJNm7",
  "metadata": {
    "name": "aeqiTreasury",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Treasury module — USDC vault, deposits, ACL-gated withdrawals"
  },
  "instructions": [
    {
      "name": "deposit",
      "docs": [
        "Deposit `amount` into the treasury vault. Permissionless — anyone",
        "can fund the treasury. Wraps the SPL transfer so the indexer gets a",
        "typed `TreasuryDeposited` event instead of having to filter raw",
        "Token-2022 transfers."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "company"
        },
        {
          "name": "moduleState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  109,
                  111,
                  100,
                  117,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "company"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "docs": [
            "Doesn't sign the deposit (depositor signs)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "company"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "depositorTa",
          "writable": true
        },
        {
          "name": "depositor",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "init",
      "docs": [
        "Module init — called by the company authority during the company's",
        "creation mode. Gating:",
        "- `company` PDA must be derived under aeqi_company and decoded (no fake",
        "pubkeys / no PDA squatting on attacker-owned accounts).",
        "- signer (`payer`) must equal `company.authority`.",
        "- company must still be in creation mode — module slots are not",
        "reconfigurable once the company goes live in this iteration."
      ],
      "discriminator": [
        220,
        59,
        207,
        236,
        108,
        250,
        47,
        100
      ],
      "accounts": [
        {
          "name": "company",
          "docs": [
            "Company PDA — must be a real Company account owned by aeqi_company.",
            "`seeds::program` binds derivation to the aeqi_company program ID; the",
            "`Account<Company>` typing forces deserialization, so attackers can't",
            "substitute an arbitrary keypair to PDA-squat the module_state slot."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  117,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "company.company_id",
                "account": "company"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                166,
                105,
                93,
                107,
                50,
                178,
                23,
                242,
                187,
                64,
                51,
                167,
                56,
                170,
                206,
                1,
                133,
                135,
                194,
                231,
                203,
                235,
                211,
                217,
                50,
                144,
                58,
                163,
                182,
                136,
                137,
                104
              ]
            }
          }
        },
        {
          "name": "moduleState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  109,
                  111,
                  100,
                  117,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "company"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "treasuryAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Withdraw `amount` from the treasury vault to `recipient_ta`. The",
        "vault is owned by the program-controlled PDA",
        "`[b\"treasury_vault_authority\", company]`; we sign via PDA seeds.",
        "Authority gate: caller must equal `module_state.treasury_authority`."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "company"
        },
        {
          "name": "moduleState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  109,
                  111,
                  100,
                  117,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "company"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "company"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "recipientTa",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "treasuryModuleState",
      "discriminator": [
        106,
        72,
        119,
        199,
        128,
        149,
        32,
        137
      ]
    },
    {
      "name": "company",
      "discriminator": [
        71,
        85,
        171,
        132,
        199,
        242,
        21,
        62
      ]
    }
  ],
  "events": [
    {
      "name": "treasuryDeposited",
      "discriminator": [
        1,
        193,
        184,
        0,
        137,
        134,
        85,
        50
      ]
    },
    {
      "name": "treasuryWithdrew",
      "discriminator": [
        220,
        114,
        25,
        15,
        0,
        115,
        171,
        74
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "caller is not the configured treasury authority"
    },
    {
      "code": 6001,
      "name": "trustNotInCreationMode",
      "msg": "company must be in creation mode to initialize the treasury module"
    }
  ],
  "types": [
    {
      "name": "treasuryDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "depositorTa",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "treasuryModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "treasuryAuthority",
            "docs": [
              "The single account allowed to authorize withdrawals. In creation mode",
              "the factory sets this to the company authority; in live mode it gets",
              "rewritten to a governance-signer PDA so withdrawals require an executed",
              "proposal."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasuryWithdrew",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "recipientTa",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "company",
      "docs": [
        "Core COMPANY account — one per AEQI company. PDA seeded `[b\"company\", company_id]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "companyId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "creationMode",
            "type": "bool"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "moduleCount",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
