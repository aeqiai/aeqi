/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_vesting.json`.
 */
export type AeqiVesting = {
  "address": "DCZKRmxjUyAZ3nptbkCBnAGqTe4E7xTvXfLbnf95uj7y",
  "metadata": {
    "name": "aeqiVesting",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Vesting module — linear cliff vesting positions for equity grants"
  },
  "instructions": [
    {
      "name": "claim",
      "docs": [
        "Claim vested tokens up to the current time. Permissionless to call —",
        "anyone can crank — but tokens go to the position's recipient ATA.",
        "If `fdv_milestone_unlocked` is set, returns the full `total_amount`",
        "regardless of linear schedule."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "trust"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "account",
                "path": "position.position_id",
                "account": "vestingPosition"
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
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
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
                "path": "trust"
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
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createPosition",
      "docs": [
        "Create a vesting position. Caller is the grantor (treasury authority,",
        "founder, etc.). The recipient + mint + schedule are recorded; tokens",
        "must be deposited into the vesting vault separately so the program",
        "can transfer them at claim time."
      ],
      "discriminator": [
        48,
        215,
        197,
        153,
        96,
        203,
        180,
        133
      ],
      "accounts": [
        {
          "name": "trust"
        },
        {
          "name": "moduleState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
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
                "path": "trust"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "positionId"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "grantor",
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
          "name": "positionId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "recipient",
          "type": "pubkey"
        },
        {
          "name": "totalAmount",
          "type": "u64"
        },
        {
          "name": "startTime",
          "type": "i64"
        },
        {
          "name": "cliffTime",
          "type": "i64"
        },
        {
          "name": "endTime",
          "type": "i64"
        },
        {
          "name": "contributionRequired",
          "type": "u64"
        },
        {
          "name": "contributionMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "init",
      "docs": [
        "Module init — gated to the trust authority during creation mode so",
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
          "name": "trust",
          "docs": [
            "Trust PDA — must be a real Trust account owned by aeqi_trust."
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
                "path": "trust.trust_id",
                "account": "trust"
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
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
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
                "path": "trust"
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
      "name": "markFdvMilestone",
      "docs": [
        "Mark this vesting position as FDV-milestone-unlocked. The grantor",
        "(typically a treasury authority or governance signer) signs to",
        "confirm the company has hit its FDV target, which immediately",
        "vests the entire `total_amount` regardless of the linear schedule.",
        "One-way flag."
      ],
      "discriminator": [
        29,
        42,
        250,
        37,
        60,
        237,
        149,
        227
      ],
      "accounts": [
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "position.trust",
                "account": "vestingPosition"
              },
              {
                "kind": "account",
                "path": "position.position_id",
                "account": "vestingPosition"
              }
            ]
          }
        },
        {
          "name": "grantor",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "payContribution",
      "docs": [
        "Pay the contribution requirement on a vesting position. Recipient",
        "signs to burn `position.contribution_required` of the",
        "contribution_mint (typically the company's cap-table token or USDC),",
        "flipping `contribution_paid = true` so claim() will allow draws."
      ],
      "discriminator": [
        41,
        86,
        11,
        120,
        68,
        31,
        217,
        2
      ],
      "accounts": [
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "position.trust",
                "account": "vestingPosition"
              },
              {
                "kind": "account",
                "path": "position.position_id",
                "account": "vestingPosition"
              }
            ]
          }
        },
        {
          "name": "contributionMint",
          "writable": true
        },
        {
          "name": "recipientContributionTa",
          "writable": true
        },
        {
          "name": "recipient",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "trust",
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
    },
    {
      "name": "vestingModuleState",
      "discriminator": [
        109,
        21,
        10,
        90,
        194,
        76,
        58,
        239
      ]
    },
    {
      "name": "vestingPosition",
      "discriminator": [
        51,
        62,
        55,
        157,
        232,
        141,
        253,
        13
      ]
    }
  ],
  "events": [
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "contributionPaid",
      "discriminator": [
        43,
        138,
        106,
        20,
        130,
        80,
        200,
        234
      ]
    },
    {
      "name": "fdvMilestoneHit",
      "discriminator": [
        113,
        48,
        169,
        243,
        11,
        152,
        29,
        199
      ]
    },
    {
      "name": "positionCreated",
      "discriminator": [
        63,
        226,
        54,
        63,
        141,
        22,
        31,
        221
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidSchedule",
      "msg": "invalid schedule: start < cliff < end required"
    },
    {
      "code": 6001,
      "name": "zeroAmount",
      "msg": "vesting amount must be > 0"
    },
    {
      "code": 6002,
      "name": "nothingToClaim",
      "msg": "nothing to claim — fully claimed or not yet vested"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "caller is not the grantor of this vesting position"
    },
    {
      "code": 6004,
      "name": "alreadyUnlocked",
      "msg": "FDV milestone has already been hit on this position"
    },
    {
      "code": 6005,
      "name": "contributionUnpaid",
      "msg": "contribution requirement not yet paid — call pay_contribution first"
    },
    {
      "code": 6006,
      "name": "noContributionRequired",
      "msg": "this position has no contribution requirement"
    },
    {
      "code": 6007,
      "name": "contributionAlreadyPaid",
      "msg": "contribution has already been paid"
    },
    {
      "code": 6008,
      "name": "contributionMintMismatch",
      "msg": "contribution_mint does not match the position's recorded mint"
    },
    {
      "code": 6009,
      "name": "mathOverflow",
      "msg": "math overflow"
    },
    {
      "code": 6010,
      "name": "trustNotInCreationMode",
      "msg": "trust must be in creation mode to initialize the vesting module"
    }
  ],
  "types": [
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "positionId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "contributionPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "positionId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recipient",
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
      "name": "fdvMilestoneHit",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "positionId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "positionCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "positionId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "cliffTime",
            "type": "i64"
          },
          {
            "name": "endTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "trust",
      "docs": [
        "Core TRUST account — one per AEQI company. PDA seeded `[b\"trust\", trust_id]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trustId",
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
    },
    {
      "name": "vestingModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "positionCount",
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
      "name": "vestingPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "positionId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "grantor",
            "type": "pubkey"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "claimedAmount",
            "type": "u64"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "cliffTime",
            "type": "i64"
          },
          {
            "name": "endTime",
            "type": "i64"
          },
          {
            "name": "fdvMilestoneUnlocked",
            "docs": [
              "FDV milestone — when set true, vested_amount_at() short-circuits to",
              "`total_amount`. Used for fully-vested-on-milestone-hit grants",
              "(founder unlock when company FDV crosses a target)."
            ],
            "type": "bool"
          },
          {
            "name": "contributionRequired",
            "docs": [
              "Contribution requirement — quote amount the recipient must pay (burn)",
              "before claims unlock. Zero means no contribution gate."
            ],
            "type": "u64"
          },
          {
            "name": "contributionPaid",
            "type": "bool"
          },
          {
            "name": "contributionMint",
            "type": "pubkey"
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
