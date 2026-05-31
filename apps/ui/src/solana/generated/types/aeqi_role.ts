/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_role.json`.
 */
export type AeqiRole = {
  "address": "4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB",
  "metadata": {
    "name": "aeqiRole",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Role module — role DAG, role types, delegations, vote checkpoints"
  },
  "instructions": [
    {
      "name": "assignRole",
      "docs": [
        "Assign an account to a vacant role. Sets status = Occupied and",
        "auto-self-delegates voting power."
      ],
      "discriminator": [
        255,
        174,
        125,
        180,
        203,
        155,
        202,
        131
      ],
      "accounts": [
        {
          "name": "role",
          "writable": true
        },
        {
          "name": "roleType"
        },
        {
          "name": "company",
          "relations": [
            "role"
          ]
        },
        {
          "name": "callerRole",
          "docs": [
            "The role held by the caller. Omitted only for first root-role",
            "self-assignment bootstrap."
          ],
          "optional": true
        },
        {
          "name": "checkpoint",
          "docs": [
            "Checkpoint is keyed on the *assignee* pubkey, not the payer — that's",
            "the semantics `cast_vote_role` reads back (seeds with `voter.key()`).",
            "Using `payer.key()` here would put the checkpoint at the wrong PDA",
            "whenever someone-with-authority assigns a different account to a",
            "role, which is the common case."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  99,
                  107,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "account",
                "path": "role_type.role_type_id",
                "account": "roleType"
              },
              {
                "kind": "arg",
                "path": "account"
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
          "name": "account",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "createRole",
      "docs": [
        "Create a new role under a parent role. Authority: caller must hold a",
        "role that is an ancestor of `parent_role_id` (or be the COMPANY authority",
        "during creation mode). The off-chain client supplies the ancestor walk",
        "in `remaining_accounts`."
      ],
      "discriminator": [
        170,
        147,
        127,
        223,
        222,
        112,
        205,
        163
      ],
      "accounts": [
        {
          "name": "company",
          "docs": [
            "role_type PDAs. Authority gating is handled via the caller_role walk."
          ]
        },
        {
          "name": "roleType",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  116,
                  121,
                  112,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "arg",
                "path": "roleTypeId"
              }
            ]
          }
        },
        {
          "name": "role",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "arg",
                "path": "roleId"
              }
            ]
          }
        },
        {
          "name": "callerRole",
          "docs": [
            "The role held by the caller (only required in live mode)."
          ],
          "optional": true
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
          "name": "parentRoleId",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        },
        {
          "name": "ipfsCid",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "createRoleType",
      "docs": [
        "Define a role type. Lower hierarchy numbers mean higher authority",
        "(0 = founder/admin)."
      ],
      "discriminator": [
        145,
        163,
        22,
        51,
        196,
        210,
        168,
        171
      ],
      "accounts": [
        {
          "name": "company"
        },
        {
          "name": "roleType",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  116,
                  121,
                  112,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "arg",
                "path": "roleTypeId"
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
          "name": "roleTypeId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "hierarchy",
          "type": "u32"
        },
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "roleTypeConfig"
            }
          }
        }
      ]
    },
    {
      "name": "delegateRole",
      "docs": [
        "Delegate this role's voting power to another account. Decrements the",
        "previous delegatee's checkpoint and increments the new delegatee's."
      ],
      "discriminator": [
        135,
        86,
        163,
        119,
        149,
        243,
        53,
        144
      ],
      "accounts": [
        {
          "name": "role"
        },
        {
          "name": "roleType"
        },
        {
          "name": "delegation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  100,
                  101,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "role.company",
                "account": "role"
              },
              {
                "kind": "account",
                "path": "role.role_id",
                "account": "role"
              }
            ]
          }
        },
        {
          "name": "prevCheckpoint",
          "docs": [
            "Optional — required only when re-delegating away from a prior",
            "delegatee. First-time delegation passes None."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "newCheckpoint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  99,
                  107,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "role.company",
                "account": "role"
              },
              {
                "kind": "account",
                "path": "role_type.role_type_id",
                "account": "roleType"
              },
              {
                "kind": "account",
                "path": "newDelegatee"
              }
            ]
          }
        },
        {
          "name": "newDelegatee",
          "docs": [
            "and as the recipient of the +1 vote. Doesn't need to sign."
          ]
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
          "name": "delegatee",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "finalize",
      "docs": [
        "Module finalize — borsh-deserializes the role-module config from the",
        "COMPANY `BytesConfig` slot under `ROLE_CONFIG_KEY` and pre-creates any",
        "role types declared at template time."
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
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
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
        }
      ],
      "args": []
    },
    {
      "name": "getPastRoleVotes",
      "docs": [
        "Read-only — returns the active delegation count for `account` of",
        "`role_type` at the given slot. Used by `aeqi_governance` at vote-cast",
        "time. The client passes the most-recent checkpoint with `slot <=",
        "query_slot`; the program verifies its `slot` field is correct."
      ],
      "discriminator": [
        167,
        13,
        183,
        8,
        85,
        87,
        149,
        97
      ],
      "accounts": [
        {
          "name": "checkpoint"
        }
      ],
      "args": [
        {
          "name": "querySlot",
          "type": "u64"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "init",
      "docs": [
        "Module init — called by `aeqi_factory` during template instantiation.",
        "Stores the parent COMPANY and initializes the module state PDA.",
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
            "Company PDA — must be a real Company account owned by aeqi_company.",
            "`seeds::program` binds derivation to the aeqi_company program ID and",
            "the `Account<Company>` typing forces deserialization, preventing PDA",
            "squatting / fake-company attacks on the module_state slot."
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
                  114,
                  111,
                  108,
                  101,
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
      "name": "resignRole",
      "docs": [
        "Resign from an Occupied role. Status → Resigned, decrement checkpoint",
        "for the prior holder. The role stays on-chain but is no longer",
        "Occupied; an authorized parent can re-assign or remove it."
      ],
      "discriminator": [
        26,
        28,
        92,
        28,
        116,
        1,
        50,
        55
      ],
      "accounts": [
        {
          "name": "role",
          "writable": true
        },
        {
          "name": "roleType"
        },
        {
          "name": "company",
          "relations": [
            "role"
          ]
        },
        {
          "name": "checkpoint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  99,
                  107,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "account",
                "path": "role_type.role_type_id",
                "account": "roleType"
              },
              {
                "kind": "account",
                "path": "role.account",
                "account": "role"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "transferRole",
      "docs": [
        "Transfer an Occupied role from the current holder to a new account.",
        "Decrements the prior holder's checkpoint, increments the new holder's",
        "checkpoint."
      ],
      "discriminator": [
        15,
        254,
        204,
        127,
        173,
        206,
        135,
        86
      ],
      "accounts": [
        {
          "name": "role",
          "writable": true
        },
        {
          "name": "roleType"
        },
        {
          "name": "company",
          "relations": [
            "role"
          ]
        },
        {
          "name": "prevCheckpoint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  99,
                  107,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "account",
                "path": "role_type.role_type_id",
                "account": "roleType"
              },
              {
                "kind": "account",
                "path": "role.account",
                "account": "role"
              }
            ]
          }
        },
        {
          "name": "newCheckpoint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  108,
                  101,
                  95,
                  99,
                  107,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "company"
              },
              {
                "kind": "account",
                "path": "role_type.role_type_id",
                "account": "roleType"
              },
              {
                "kind": "account",
                "path": "newAccount"
              }
            ]
          }
        },
        {
          "name": "newAccount"
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
          "name": "newAccount",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
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
      "name": "roleDelegation",
      "discriminator": [
        68,
        128,
        43,
        64,
        140,
        152,
        97,
        233
      ]
    },
    {
      "name": "roleModuleState",
      "discriminator": [
        193,
        148,
        176,
        204,
        18,
        1,
        119,
        240
      ]
    },
    {
      "name": "roleType",
      "discriminator": [
        199,
        10,
        253,
        190,
        130,
        242,
        7,
        152
      ]
    },
    {
      "name": "roleVoteCheckpoint",
      "discriminator": [
        53,
        136,
        117,
        99,
        58,
        215,
        113,
        158
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
      "name": "roleAssigned",
      "discriminator": [
        15,
        207,
        225,
        171,
        169,
        117,
        98,
        131
      ]
    },
    {
      "name": "roleCreated",
      "discriminator": [
        203,
        8,
        94,
        252,
        142,
        13,
        51,
        221
      ]
    },
    {
      "name": "roleDelegated",
      "discriminator": [
        214,
        209,
        37,
        22,
        243,
        129,
        27,
        189
      ]
    },
    {
      "name": "roleResigned",
      "discriminator": [
        72,
        66,
        160,
        239,
        69,
        255,
        93,
        243
      ]
    },
    {
      "name": "roleTransferred",
      "discriminator": [
        234,
        2,
        29,
        68,
        201,
        65,
        162,
        222
      ]
    },
    {
      "name": "roleTypeCreated",
      "discriminator": [
        72,
        169,
        117,
        161,
        28,
        32,
        215,
        179
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "caller does not hold a role with authority for this action"
    },
    {
      "code": 6001,
      "name": "roleNotVacant",
      "msg": "role is not vacant"
    },
    {
      "code": 6002,
      "name": "roleNotOccupied",
      "msg": "role is not occupied"
    },
    {
      "code": 6003,
      "name": "authorityNotFound",
      "msg": "authority walk did not reach the target role"
    },
    {
      "code": 6004,
      "name": "invalidAuthorityWalk",
      "msg": "authority walk passed an account that did not match the expected parent"
    },
    {
      "code": 6005,
      "name": "authorityWalkTooDeep",
      "msg": "authority walk exceeded the maximum depth"
    },
    {
      "code": 6006,
      "name": "checkpointAfterQuery",
      "msg": "checkpoint slot is after the requested query slot"
    },
    {
      "code": 6007,
      "name": "prevCheckpointRequired",
      "msg": "prev_checkpoint required when re-delegating away from a prior delegatee"
    },
    {
      "code": 6008,
      "name": "invalidDelegatee",
      "msg": "delegatee cannot be the default pubkey"
    },
    {
      "code": 6009,
      "name": "roleTypeMismatch",
      "msg": "role type does not match the role"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "math overflow"
    },
    {
      "code": 6011,
      "name": "trustNotInCreationMode",
      "msg": "company must be in creation mode to initialize the role module"
    }
  ],
  "types": [
    {
      "name": "role",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
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
      "name": "roleAssigned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
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
            "name": "account",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "roleCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
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
            "name": "parentRoleId",
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
      "name": "roleDelegated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
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
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "roleDelegation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
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
            "name": "delegatee",
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
      "name": "roleModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
          },
          {
            "name": "initialized",
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
      "name": "roleResigned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
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
            "name": "from",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "roleTransferred",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
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
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "roleType",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
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
            "name": "hierarchy",
            "type": "u32"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "roleTypeConfig"
              }
            }
          },
          {
            "name": "roleCount",
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
      "name": "roleTypeConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vesting",
            "type": "bool"
          },
          {
            "name": "vestingCliff",
            "type": "i64"
          },
          {
            "name": "vestingDuration",
            "type": "i64"
          },
          {
            "name": "fdv",
            "type": "bool"
          },
          {
            "name": "fdvStart",
            "type": "u128"
          },
          {
            "name": "fdvEnd",
            "type": "u128"
          },
          {
            "name": "probationaryPeriod",
            "type": "i64"
          },
          {
            "name": "severancePeriod",
            "type": "i64"
          },
          {
            "name": "contribution",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "roleTypeCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "company",
            "type": "pubkey"
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
            "name": "hierarchy",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "roleVoteCheckpoint",
      "docs": [
        "One per (account, role_type) pair. Updated on every assignment / delegation",
        "change. `slot` records when this checkpoint was written; governance reads",
        "it via `get_past_role_votes` requiring `ckpt.slot <= query_slot`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
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
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "count",
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
