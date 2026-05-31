/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_token.json`.
 */
export type AeqiToken = {
  "address": "AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh",
  "metadata": {
    "name": "aeqiToken",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Token module — cap-table SPL Token-2022 mint authority + allocations"
  },
  "instructions": [
    {
      "name": "burnTokens",
      "docs": [
        "Burn cap-table tokens. The token account owner signs; no program",
        "authority needed (Token-2022 burn requires the owner's signature).",
        "Used for redemption, exit, buyback, vesting clawback (when the vault",
        "is owned by a vesting PDA)."
      ],
      "discriminator": [
        76,
        15,
        51,
        254,
        229,
        215,
        121,
        66
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
                  111,
                  107,
                  101,
                  110,
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
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
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
          "name": "ownerTa",
          "writable": true
        },
        {
          "name": "owner",
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
      "name": "createMint",
      "docs": [
        "Create the SPL Token-2022 mint for this COMPANY. Mint address is a PDA",
        "seeded `[b\"mint\", company]` so callers can derive it deterministically.",
        "Authority for the mint is another PDA seeded",
        "`[b\"token_authority\", company]`, owned by this program — only this",
        "program can mint or freeze."
      ],
      "discriminator": [
        69,
        44,
        215,
        132,
        253,
        214,
        41,
        45
      ],
      "accounts": [
        {
          "name": "company"
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
                  111,
                  107,
                  101,
                  110,
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
          "name": "mintAuthority",
          "docs": [
            "signer seeds) can mint or freeze the cap-table token."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
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
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
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
          "name": "tokenProgram"
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
          "name": "decimals",
          "type": "u8"
        }
      ]
    },
    {
      "name": "finalize",
      "docs": [
        "Module finalize — decodes the config bytes the factory wrote into the",
        "company's BytesConfig slot under `TOKEN_CONFIG_KEY`. Cross-program",
        "account read — the BytesConfig PDA's owner is validated against",
        "AEQI_COMPANY_ID, then the 8-byte discriminator is skipped and the bytes",
        "are borsh-deserialized into the mirror struct."
      ],
      "discriminator": [
        171,
        61,
        218,
        56,
        127,
        115,
        12,
        217
      ],
      "accounts": [
        {
          "name": "company"
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
                  111,
                  107,
                  101,
                  110,
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
          "name": "bytesConfig",
          "docs": [
            "enforces the seed derivation under the foreign program id; finalize's",
            "body validates the account's data layout + owner."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103,
                  95,
                  98,
                  121,
                  116,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "const",
                "value": [
                  1,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
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
        }
      ],
      "args": []
    },
    {
      "name": "init",
      "docs": [
        "Module init — called by the factory (or directly by the user during",
        "company spawn). Creates the TokenModuleState PDA that anchors all",
        "subsequent token operations to this company.",
        "Gated to the company authority during creation mode so the",
        "module_state PDA cannot be squatted by an attacker."
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
            "Company PDA — must be a real Company account owned by aeqi_company."
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
                  111,
                  107,
                  101,
                  110,
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
      "args": []
    },
    {
      "name": "mintTokens",
      "docs": [
        "Issue cap-table tokens. Mints `amount` tokens to `recipient_ta` via",
        "CPI into Token-2022, signing with the program-controlled mint",
        "authority PDA seeds. No off-chain key holds mint authority.",
        "",
        "Supply cap: when `module_state.max_supply_cap > 0` the post-mint",
        "total supply is checked against the cap (cap=0 means \"uncapped\",",
        "only after the module has been finalized with its config)."
      ],
      "discriminator": [
        59,
        132,
        24,
        246,
        122,
        39,
        8,
        243
      ],
      "accounts": [
        {
          "name": "company",
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
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
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
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
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
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
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
      "name": "tokenModuleState",
      "discriminator": [
        210,
        245,
        58,
        169,
        67,
        82,
        158,
        143
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
      "name": "mintCreated",
      "discriminator": [
        254,
        157,
        196,
        76,
        231,
        48,
        27,
        150
      ]
    },
    {
      "name": "tokenModuleInitialized",
      "discriminator": [
        109,
        82,
        111,
        70,
        119,
        170,
        62,
        85
      ]
    },
    {
      "name": "tokensBurned",
      "discriminator": [
        230,
        255,
        34,
        113,
        226,
        53,
        227,
        9
      ]
    },
    {
      "name": "tokensMinted",
      "discriminator": [
        207,
        212,
        128,
        194,
        175,
        54,
        64,
        24
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notInitialized",
      "msg": "token module not yet initialized"
    },
    {
      "code": 6001,
      "name": "notFinalized",
      "msg": "token module must be finalized before mint operations"
    },
    {
      "code": 6002,
      "name": "mintAlreadyCreated",
      "msg": "mint already created for this company"
    },
    {
      "code": 6003,
      "name": "mintMismatch",
      "msg": "mint account does not match the module's recorded mint"
    },
    {
      "code": 6004,
      "name": "invalidConfig",
      "msg": "BytesConfig PDA missing, malformed, or wrong owner"
    },
    {
      "code": 6005,
      "name": "supplyCapExceeded",
      "msg": "mint would exceed max_supply_cap from TokenInitConfig"
    },
    {
      "code": 6006,
      "name": "invalidTokenProgram",
      "msg": "token program must be Token-2022"
    },
    {
      "code": 6007,
      "name": "trustMismatch",
      "msg": "token module is not bound to the supplied company"
    },
    {
      "code": 6008,
      "name": "unauthorizedMintAuthority",
      "msg": "caller is not the company authority for minting"
    },
    {
      "code": 6009,
      "name": "zeroAmount",
      "msg": "amount must be > 0"
    },
    {
      "code": 6010,
      "name": "decimalsMismatch",
      "msg": "mint decimals must match finalized token config"
    },
    {
      "code": 6011,
      "name": "unauthorized",
      "msg": "caller is not authorized for this company"
    },
    {
      "code": 6012,
      "name": "trustNotInCreationMode",
      "msg": "company must be in creation mode to initialize the token module"
    }
  ],
  "types": [
    {
      "name": "mintCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tokenModuleInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "moduleState",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "tokenModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "initialized",
            "type": "u8"
          },
          {
            "name": "decimals",
            "docs": [
              "Mint decimals — populated by `finalize` from the BytesConfig blob."
            ],
            "type": "u8"
          },
          {
            "name": "maxSupplyCap",
            "docs": [
              "Authoritative supply cap from `TokenInitConfig`. `mint_tokens` will",
              "(next iteration) gate against this once minting is wired through it."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tokensBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "ownerTa",
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
      "name": "tokensMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "mint",
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
