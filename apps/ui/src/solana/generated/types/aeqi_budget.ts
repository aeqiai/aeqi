/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_budget.json`.
 */
export type AeqiBudget = {
  "address": "5PbDxvaYD9shSGxE2pQyUTqCqe6FXUMDciXSEGevFE5G",
  "metadata": {
    "name": "aeqiBudget",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Budget module — role-bound treasury allocations + spend tracking"
  },
  "instructions": [
    {
      "name": "createBudget",
      "docs": [
        "Create a budget allocation for a role. The grantor (typically a",
        "treasury authority or governance signer) signs to lock the",
        "allocation. A budget can be sourced from TRUST (no parent) or from",
        "a parent budget (which the grantor must control).",
        "",
        "Authority gate: in this iteration, only the trust authority can",
        "originate budgets (i.e. budgets sourced directly from TRUST). Once",
        "governance + role-walk capability lands, child budgets sourced from",
        "a parent budget will be gated on the parent budget's grantor / role",
        "instead."
      ],
      "discriminator": [
        235,
        230,
        179,
        201,
        233,
        58,
        158,
        72
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
                  98,
                  117,
                  100,
                  103,
                  101,
                  116,
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
          "name": "budget",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  100,
                  103,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "budgetId"
              }
            ]
          }
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
          "name": "budgetId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
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
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "expiry",
          "type": "i64"
        },
        {
          "name": "parentBudgetId",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "freeze",
      "docs": [
        "Freeze a budget — blocks further spends. Grantor signs."
      ],
      "discriminator": [
        255,
        91,
        207,
        84,
        251,
        194,
        254,
        63
      ],
      "accounts": [
        {
          "name": "budget",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  100,
                  103,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "budget.trust",
                "account": "budget"
              },
              {
                "kind": "account",
                "path": "budget.budget_id",
                "account": "budget"
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
                  98,
                  117,
                  100,
                  103,
                  101,
                  116,
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
      "name": "recordSpend",
      "docs": [
        "Record a spend against the budget. Caller must hold the occupied",
        "target role referenced by the budget, and budget enforces the cap,",
        "expiry, and frozen flag."
      ],
      "discriminator": [
        111,
        102,
        17,
        64,
        245,
        202,
        79,
        55
      ],
      "accounts": [
        {
          "name": "budget",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  100,
                  103,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "budget.trust",
                "account": "budget"
              },
              {
                "kind": "account",
                "path": "budget.budget_id",
                "account": "budget"
              }
            ]
          }
        },
        {
          "name": "spenderRole"
        },
        {
          "name": "spender",
          "signer": true
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
      "name": "unfreeze",
      "docs": [
        "Unfreeze. Grantor signs."
      ],
      "discriminator": [
        133,
        160,
        68,
        253,
        80,
        232,
        218,
        247
      ],
      "accounts": [
        {
          "name": "budget",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  100,
                  103,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "budget.trust",
                "account": "budget"
              },
              {
                "kind": "account",
                "path": "budget.budget_id",
                "account": "budget"
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
      "name": "budgetModuleState",
      "discriminator": [
        7,
        61,
        109,
        119,
        43,
        155,
        212,
        140
      ]
    },
    {
      "name": "role",
      "discriminator": [
        46,
        219,
        197,
        24,
        233,
        249,
        253,
        154
      ]
    },
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
    }
  ],
  "events": [
    {
      "name": "budgetCreated",
      "discriminator": [
        8,
        193,
        220,
        133,
        187,
        224,
        77,
        228
      ]
    },
    {
      "name": "budgetFrozen",
      "discriminator": [
        0,
        87,
        55,
        175,
        218,
        204,
        122,
        193
      ]
    },
    {
      "name": "budgetSpent",
      "discriminator": [
        250,
        225,
        202,
        251,
        15,
        255,
        89,
        167
      ]
    },
    {
      "name": "budgetUnfrozen",
      "discriminator": [
        202,
        106,
        227,
        60,
        122,
        244,
        146,
        237
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
      "name": "invalidExpiry",
      "msg": "expiry must be 0 (no expiry) or in the future"
    },
    {
      "code": 6002,
      "name": "budgetFrozen",
      "msg": "budget is frozen"
    },
    {
      "code": 6003,
      "name": "budgetExpired",
      "msg": "budget has expired"
    },
    {
      "code": 6004,
      "name": "exceedsAllocation",
      "msg": "spend would exceed budget.amount"
    },
    {
      "code": 6005,
      "name": "mathOverflow",
      "msg": "math overflow"
    },
    {
      "code": 6006,
      "name": "unauthorized",
      "msg": "caller is not authorized for this budget"
    },
    {
      "code": 6007,
      "name": "trustNotInCreationMode",
      "msg": "trust must be in creation mode to initialize the budget module"
    }
  ],
  "types": [
    {
      "name": "budget",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
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
              "Parent budget if hierarchical; [0u8; 32] if sourced from TRUST directly."
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
      "name": "budgetCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
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
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "expiry",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "budgetFrozen",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
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
          }
        ]
      }
    },
    {
      "name": "budgetModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "budgetCount",
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
      "name": "budgetSpent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
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
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "budgetUnfrozen",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
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
          }
        ]
      }
    },
    {
      "name": "role",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "roleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "roleTypeId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "parentRoleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "statusSince",
            "type": "i64"
          },
          {
            "name": "ipfsCid",
            "type": {
              "array": [
                "u8",
                64
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
    }
  ]
};
