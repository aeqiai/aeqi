/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_funding.json`.
 */
export type AeqiFunding = {
  "address": "8dCM5qRnfMAZGdsC8pYYQzomVdQpihL9jgwAXoPaie3U",
  "metadata": {
    "name": "aeqiFunding",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Funding module — capital raise orchestration over Unifutures + Budget"
  },
  "instructions": [
    {
      "name": "activateBondingCurve",
      "docs": [
        "Activate a BondingCurve-kind funding request — CPIs into",
        "`aeqi_unifutures::create_curve`."
      ],
      "discriminator": [
        146,
        108,
        229,
        90,
        192,
        83,
        53,
        123
      ],
      "accounts": [
        {
          "name": "request",
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
                  105,
                  110,
                  103,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request.company",
                "account": "fundingRequest"
              },
              {
                "kind": "account",
                "path": "request.request_id",
                "account": "fundingRequest"
              }
            ]
          }
        },
        {
          "name": "budget"
        },
        {
          "name": "company"
        },
        {
          "name": "unifuturesModuleState",
          "writable": true
        },
        {
          "name": "curve",
          "writable": true
        },
        {
          "name": "assetMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "aeqiUnifuturesProgram",
          "address": "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "curveId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "curveType",
          "type": "u8"
        },
        {
          "name": "startPrice",
          "type": "u128"
        },
        {
          "name": "endPrice",
          "type": "u128"
        },
        {
          "name": "maxSupply",
          "type": "u64"
        },
        {
          "name": "reserveRatioPpm",
          "type": "u32"
        }
      ]
    },
    {
      "name": "activateCommitmentSale",
      "docs": [
        "Activate a CommitmentSale-kind funding request — CPIs into",
        "`aeqi_unifutures::create_commitment_sale` with the request's params.",
        "Sets status = Activated, primitive_id = the new sale's id.",
        "(BondingCurve + Exit activation follow the same shape; this iteration",
        "covers kind=0 only.)"
      ],
      "discriminator": [
        164,
        192,
        119,
        43,
        55,
        190,
        195,
        208
      ],
      "accounts": [
        {
          "name": "request",
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
                  105,
                  110,
                  103,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request.company",
                "account": "fundingRequest"
              },
              {
                "kind": "account",
                "path": "request.request_id",
                "account": "fundingRequest"
              }
            ]
          }
        },
        {
          "name": "budget"
        },
        {
          "name": "company"
        },
        {
          "name": "unifuturesModuleState",
          "writable": true
        },
        {
          "name": "sale",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "aeqiUnifuturesProgram",
          "address": "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "saleId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "overflowQuote",
          "type": "u64"
        },
        {
          "name": "durationSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "activateExit",
      "docs": [
        "Activate an Exit-kind funding request — CPIs into",
        "`aeqi_unifutures::create_exit`."
      ],
      "discriminator": [
        172,
        26,
        206,
        49,
        238,
        241,
        102,
        5
      ],
      "accounts": [
        {
          "name": "request",
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
                  105,
                  110,
                  103,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request.company",
                "account": "fundingRequest"
              },
              {
                "kind": "account",
                "path": "request.request_id",
                "account": "fundingRequest"
              }
            ]
          }
        },
        {
          "name": "budget"
        },
        {
          "name": "company"
        },
        {
          "name": "unifuturesModuleState",
          "writable": true
        },
        {
          "name": "exit",
          "writable": true
        },
        {
          "name": "assetMint",
          "docs": [
            "deserializes it as a Mint and pins it onto the Exit account."
          ]
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "aeqiUnifuturesProgram",
          "address": "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "exitId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "exitQuote",
          "type": "u64"
        },
        {
          "name": "totalSupplySnapshot",
          "type": "u64"
        },
        {
          "name": "durationSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "cancelFundingRequest",
      "docs": [
        "Cancel a pending funding request. Only the creator can cancel."
      ],
      "discriminator": [
        213,
        31,
        142,
        101,
        67,
        12,
        104,
        156
      ],
      "accounts": [
        {
          "name": "request",
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
                  105,
                  110,
                  103,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request.company",
                "account": "fundingRequest"
              },
              {
                "kind": "account",
                "path": "request.request_id",
                "account": "fundingRequest"
              }
            ]
          }
        },
        {
          "name": "creator",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "createFundingRequest",
      "docs": [
        "Declare a funding request. Records the intent without activating.",
        "`kind` is 0 (CommitmentSale), 1 (BondingCurve), or 2 (Exit)."
      ],
      "discriminator": [
        33,
        171,
        45,
        145,
        98,
        160,
        250,
        111
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
                "path": "company"
              }
            ]
          }
        },
        {
          "name": "request",
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
                  105,
                  110,
                  103,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "arg",
                "path": "requestId"
              }
            ]
          }
        },
        {
          "name": "budget"
        },
        {
          "name": "creator",
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
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "budgetId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "assetAmount",
          "type": "u64"
        },
        {
          "name": "targetQuote",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalizeFundingRequest",
      "docs": [
        "Finalize an Activated funding request — closes the lifecycle once",
        "the underlying Unifutures primitive has settled. Caller is the",
        "creator (they own request lifecycle), and finalize is permanent;",
        "downstream excess-budget refund / vesting role hooks will read",
        "`status == Finalized` as their gate."
      ],
      "discriminator": [
        36,
        15,
        0,
        164,
        202,
        62,
        88,
        112
      ],
      "accounts": [
        {
          "name": "request",
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
                  105,
                  110,
                  103,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request.company",
                "account": "fundingRequest"
              },
              {
                "kind": "account",
                "path": "request.request_id",
                "account": "fundingRequest"
              }
            ]
          }
        },
        {
          "name": "creator",
          "signer": true
        }
      ],
      "args": []
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
    }
  ],
  "accounts": [
    {
      "name": "budget",
      "discriminator": [
        35,
        151,
        58,
        65,
        187,
        148,
        119,
        218
      ]
    },
    {
      "name": "fundingModuleState",
      "discriminator": [
        125,
        235,
        179,
        163,
        60,
        130,
        149,
        174
      ]
    },
    {
      "name": "fundingRequest",
      "discriminator": [
        78,
        109,
        168,
        114,
        238,
        219,
        124,
        44
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
      "name": "fundingRequestActivated",
      "discriminator": [
        182,
        156,
        228,
        91,
        183,
        128,
        158,
        71
      ]
    },
    {
      "name": "fundingRequestCancelled",
      "discriminator": [
        166,
        115,
        41,
        79,
        214,
        196,
        62,
        142
      ]
    },
    {
      "name": "fundingRequestCreated",
      "discriminator": [
        60,
        88,
        249,
        130,
        176,
        93,
        151,
        213
      ]
    },
    {
      "name": "fundingRequestFinalized",
      "discriminator": [
        109,
        205,
        147,
        128,
        20,
        188,
        10,
        20
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidKind",
      "msg": "kind must be 0 (CommitmentSale), 1 (BondingCurve), or 2 (Exit)"
    },
    {
      "code": 6001,
      "name": "zeroAmount",
      "msg": "amount must be > 0"
    },
    {
      "code": 6002,
      "name": "mathOverflow",
      "msg": "math overflow"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "only creator can cancel a request"
    },
    {
      "code": 6004,
      "name": "trustMismatch",
      "msg": "company account does not match the funding request"
    },
    {
      "code": 6005,
      "name": "cannotCancel",
      "msg": "request is not in Pending status — can't cancel"
    },
    {
      "code": 6006,
      "name": "cannotActivate",
      "msg": "request is not in Pending status — can't activate"
    },
    {
      "code": 6007,
      "name": "cannotFinalize",
      "msg": "request is not in Activated status — can't finalize"
    },
    {
      "code": 6008,
      "name": "wrongKind",
      "msg": "request kind doesn't match this activation ix (kind=0 for CommitmentSale)"
    },
    {
      "code": 6009,
      "name": "budgetMismatch",
      "msg": "budget account does not match the funding request"
    },
    {
      "code": 6010,
      "name": "budgetUnavailable",
      "msg": "budget is frozen or expired"
    },
    {
      "code": 6011,
      "name": "budgetCapacityExceeded",
      "msg": "budget has insufficient remaining allocation"
    },
    {
      "code": 6012,
      "name": "trustNotInCreationMode",
      "msg": "company must be in creation mode to initialize the funding module"
    }
  ],
  "types": [
    {
      "name": "budget",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "budgetId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "grantor",
            "type": "pubkey"
          },
          {
            "name": "targetRoleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "parentBudgetId",
            "docs": [
              "Parent budget if hierarchical; [0u8; 32] if sourced from COMPANY directly."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "expiry",
            "type": "i64"
          },
          {
            "name": "frozen",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "fundingModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "requestCount",
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
      "name": "fundingRequest",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "budgetId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "assetAmount",
            "type": "u64"
          },
          {
            "name": "targetQuote",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "primitiveId",
            "docs": [
              "Set on activation to the underlying Unifutures primitive's id",
              "(sale_id / curve_id / exit_id depending on kind)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "fundingRequestActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "primitiveId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "fundingRequestCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "fundingRequestCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "budgetId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "assetAmount",
            "type": "u64"
          },
          {
            "name": "targetQuote",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "fundingRequestFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "primitiveId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
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
