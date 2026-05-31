/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_fund.json`.
 */
export type AeqiFund = {
  "address": "DaFpZcqMaL4rmAemJ2WBeUth42PMmHxNg9t6j9h9p7YP",
  "metadata": {
    "name": "aeqiFund",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Fund module — NAV-based fund accounting, LP shares, deposits, redeems"
  },
  "instructions": [
    {
      "name": "claimCarry",
      "docs": [
        "Manager claims accrued carry from the fund vault. Resets",
        "`accrued_carry` to zero. Vault → manager TA, PDA-signed."
      ],
      "discriminator": [
        47,
        17,
        35,
        110,
        163,
        40,
        180,
        159
      ],
      "accounts": [
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "fundAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100,
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
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "fundQuoteVault",
          "writable": true
        },
        {
          "name": "managerQuoteTa",
          "writable": true
        },
        {
          "name": "manager",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createFund",
      "docs": [
        "Create a fund. The manager defines the quote_mint (USDC etc.). The",
        "fund starts with NAV=0, total_shares=0; share price is 1:1 at first",
        "deposit and adjusts based on NAV thereafter."
      ],
      "discriminator": [
        38,
        128,
        18,
        11,
        203,
        0,
        153,
        21
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
                  102,
                  117,
                  110,
                  100,
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
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "arg",
                "path": "fundId"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "manager",
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
          "name": "fundId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "carryBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "LP deposits `amount` of quote into the fund. Receives shares",
        "proportional to current NAV: shares = amount * total_shares / gross_nav",
        "(1:1 at first deposit when gross_nav == 0). The actual share token",
        "is recorded in an LpShare PDA per LP — no separate SPL mint."
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
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "fundAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100,
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
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "fundQuoteVault",
          "writable": true
        },
        {
          "name": "lpQuoteTa",
          "writable": true
        },
        {
          "name": "lpShare",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  115,
                  104,
                  97,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "lp"
              }
            ]
          }
        },
        {
          "name": "lp",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
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
        "Module init — gated to the company authority during creation mode so",
        "the module_state PDA cannot be squatted by an attacker."
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
                  102,
                  117,
                  110,
                  100,
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
      "name": "redeem",
      "docs": [
        "LP burns `shares` to receive quote pro-rata to NAV. Reverses",
        "deposit: quote_out = shares * gross_nav / total_shares."
      ],
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "fundAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100,
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
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "fundQuoteVault",
          "writable": true
        },
        {
          "name": "lpQuoteTa",
          "writable": true
        },
        {
          "name": "lpShare",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  115,
                  104,
                  97,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "lp"
              }
            ]
          }
        },
        {
          "name": "lp",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateNav",
      "docs": [
        "Manager-only mark-to-market. Recompute LP-attributable NAV; if it",
        "crosses the prior HWM, accrue carry on the increase and reset HWM",
        "to the post-carry NAV. Down-marks just reduce gross_nav (no carry",
        "clawback — high-water-mark semantics).",
        "",
        "`new_gross_nav` is the manager's reported portfolio mark including",
        "any unclaimed carry already sitting in the vault — i.e. the full",
        "vault valuation, not LP-attributable. Carry is split off here."
      ],
      "discriminator": [
        56,
        16,
        234,
        109,
        155,
        165,
        5,
        0
      ],
      "accounts": [
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "fund.company",
                "account": "fund"
              },
              {
                "kind": "account",
                "path": "fund.fund_id",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "manager",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newGrossNav",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "fund",
      "discriminator": [
        62,
        128,
        183,
        208,
        91,
        31,
        212,
        209
      ]
    },
    {
      "name": "fundModuleState",
      "discriminator": [
        189,
        34,
        27,
        231,
        36,
        183,
        44,
        84
      ]
    },
    {
      "name": "lpShare",
      "discriminator": [
        137,
        210,
        47,
        236,
        167,
        57,
        72,
        145
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
      "name": "carryClaimed",
      "discriminator": [
        88,
        23,
        172,
        190,
        94,
        40,
        173,
        30
      ]
    },
    {
      "name": "fundCreated",
      "discriminator": [
        31,
        8,
        73,
        167,
        79,
        82,
        191,
        82
      ]
    },
    {
      "name": "fundDeposited",
      "discriminator": [
        67,
        220,
        171,
        204,
        55,
        32,
        97,
        249
      ]
    },
    {
      "name": "fundRedeemed",
      "discriminator": [
        127,
        189,
        21,
        173,
        29,
        39,
        169,
        188
      ]
    },
    {
      "name": "navUpdated",
      "discriminator": [
        182,
        153,
        142,
        26,
        205,
        24,
        110,
        154
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "amount must be > 0"
    },
    {
      "code": 6001,
      "name": "invalidBps",
      "msg": "carry_bps must be ≤ 10000 (100%)"
    },
    {
      "code": 6002,
      "name": "mathOverflow",
      "msg": "math overflow"
    },
    {
      "code": 6003,
      "name": "shareTooSmall",
      "msg": "computed shares or quote_out rounded to zero"
    },
    {
      "code": 6004,
      "name": "emptyFund",
      "msg": "fund has no shares — no LPs to redeem to"
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "caller is not the LP recorded on this share account"
    },
    {
      "code": 6006,
      "name": "insufficientShares",
      "msg": "LP doesn't have enough shares"
    },
    {
      "code": 6007,
      "name": "notManager",
      "msg": "only the fund manager can call this ix"
    },
    {
      "code": 6008,
      "name": "noCarry",
      "msg": "no accrued carry to claim"
    },
    {
      "code": 6009,
      "name": "quoteMintMismatch",
      "msg": "quote mint does not match the fund's configured quote mint"
    },
    {
      "code": 6010,
      "name": "trustNotInCreationMode",
      "msg": "company must be in creation mode to initialize the fund module"
    }
  ],
  "types": [
    {
      "name": "carryClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manager",
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
      "name": "fund",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manager",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "grossNav",
            "docs": [
              "LP-attributable NAV. Excludes `accrued_carry` so deposit/redeem",
              "share-price math remains LP-fair."
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "highWaterMark",
            "type": "u64"
          },
          {
            "name": "carryBps",
            "type": "u16"
          },
          {
            "name": "accruedCarry",
            "docs": [
              "Carry the manager has earned via NAV-up updates beyond HWM. Sits",
              "in the fund vault until `claim_carry` transfers it out to the",
              "manager. Counted separately from `gross_nav` so the share price",
              "LPs see is exactly what they're owed."
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
      "name": "fundCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manager",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "carryBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "fundDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "lp",
            "type": "pubkey"
          },
          {
            "name": "quoteIn",
            "type": "u64"
          },
          {
            "name": "sharesIssued",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "fundModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundCount",
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
      "name": "fundRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "lp",
            "type": "pubkey"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "quoteOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpShare",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "lp",
            "type": "pubkey"
          },
          {
            "name": "shares",
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
      "name": "navUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "fundId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "grossNav",
            "type": "u64"
          },
          {
            "name": "highWaterMark",
            "type": "u64"
          },
          {
            "name": "accruedCarry",
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
