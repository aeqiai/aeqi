/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_trust.json`.
 */
export type AeqiTrust = {
  "address": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV",
  "metadata": {
    "name": "aeqiTrust",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI core protocol — TRUST registry, ACL flags, config store, execute gateway"
  },
  "instructions": [
    {
      "name": "adoptModuleImplementation",
      "docs": [
        "Pull a provider-published implementation into one module slot for one",
        "TRUST. This is the Solana-native replacement for global beacon upgrades:",
        "providers publish, but the TRUST authority chooses when to adopt."
      ],
      "discriminator": [
        52,
        6,
        24,
        70,
        40,
        104,
        14,
        221
      ],
      "accounts": [
        {
          "name": "trust",
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
            ]
          }
        },
        {
          "name": "module",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
              },
              {
                "kind": "account",
                "path": "module.module_id",
                "account": "module"
              }
            ]
          }
        },
        {
          "name": "implementation",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  117,
                  108,
                  101,
                  95,
                  105,
                  109,
                  112,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "implementation.provider",
                "account": "moduleImplementation"
              },
              {
                "kind": "account",
                "path": "implementation.module_id",
                "account": "moduleImplementation"
              },
              {
                "kind": "account",
                "path": "implementation.version",
                "account": "moduleImplementation"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "trustAcl",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalize",
      "docs": [
        "Exit creation mode — ACL checks become live."
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
          "name": "trust",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Create a fresh TRUST PDA. Enters creation mode — ACL checks are skipped",
        "until `finalize` is called. Only the `authority` (factory or owning",
        "account) may register modules and set configs while in creation mode."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "trust",
          "writable": true,
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
                "kind": "arg",
                "path": "trustId"
              }
            ]
          }
        },
        {
          "name": "authority",
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
          "name": "trustId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "publishModuleImplementation",
      "docs": [
        "Publish a provider-owned implementation candidate. This does not mutate",
        "any TRUST. Each TRUST pulls an implementation into a module slot through",
        "`adopt_module_implementation`."
      ],
      "discriminator": [
        169,
        29,
        237,
        175,
        9,
        244,
        168,
        215
      ],
      "accounts": [
        {
          "name": "implementation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  117,
                  108,
                  101,
                  95,
                  105,
                  109,
                  112,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "provider"
              },
              {
                "kind": "arg",
                "path": "moduleId"
              },
              {
                "kind": "arg",
                "path": "version"
              }
            ]
          }
        },
        {
          "name": "implementationProgram",
          "docs": [
            "constrained to executable so the catalog cannot point at arbitrary data."
          ]
        },
        {
          "name": "provider",
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
          "name": "moduleId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "version",
          "type": "u64"
        },
        {
          "name": "metadataHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "registerModule",
      "docs": [
        "Register a module program against this TRUST during creation. Stores the",
        "selected provider implementation metadata plus initial ACL bit-flags.",
        "After finalization, module implementation changes happen through",
        "`adopt_module_implementation`."
      ],
      "discriminator": [
        102,
        197,
        187,
        68,
        50,
        57,
        8,
        172
      ],
      "accounts": [
        {
          "name": "trust",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "module",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
              },
              {
                "kind": "arg",
                "path": "moduleId"
              }
            ]
          }
        },
        {
          "name": "authority",
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
          "name": "moduleId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "programId",
          "type": "pubkey"
        },
        {
          "name": "provider",
          "type": "pubkey"
        },
        {
          "name": "implementationVersion",
          "type": "u64"
        },
        {
          "name": "implementationMetadataHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "trustAcl",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setAddressConfig",
      "docs": [
        "Set an address config slot (Pubkey). Authority-only in this iteration."
      ],
      "discriminator": [
        102,
        16,
        161,
        188,
        69,
        203,
        226,
        101
      ],
      "accounts": [
        {
          "name": "trust",
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
            ]
          }
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103,
                  95,
                  97,
                  100,
                  100,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "key"
              }
            ]
          }
        },
        {
          "name": "sourceModule",
          "docs": [
            "Reserved for future live-mode module-auth wiring."
          ],
          "optional": true
        },
        {
          "name": "authority",
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
          "name": "key",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "value",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setBytesConfig",
      "docs": [
        "Set a bytes config slot (Vec<u8>). Authority-only in this iteration."
      ],
      "discriminator": [
        35,
        47,
        206,
        133,
        144,
        125,
        179,
        110
      ],
      "accounts": [
        {
          "name": "trust",
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
            ]
          }
        },
        {
          "name": "config",
          "writable": true,
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
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "key"
              }
            ]
          }
        },
        {
          "name": "sourceModule",
          "docs": [
            "Reserved for future live-mode module-auth wiring."
          ],
          "optional": true
        },
        {
          "name": "authority",
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
          "name": "key",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "value",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "setModuleAcl",
      "docs": [
        "Set the ACL bitmask between two modules. Authority-only in this",
        "iteration; live module-signed ACL mutation is not enabled yet."
      ],
      "discriminator": [
        189,
        37,
        112,
        38,
        65,
        137,
        204,
        116
      ],
      "accounts": [
        {
          "name": "trust",
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
            ]
          }
        },
        {
          "name": "sourceModule",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
              },
              {
                "kind": "account",
                "path": "source_module.module_id",
                "account": "module"
              }
            ]
          }
        },
        {
          "name": "aclEdge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  108,
                  95,
                  101,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "account",
                "path": "source_module.module_id",
                "account": "module"
              },
              {
                "kind": "arg",
                "path": "targetModuleId"
              }
            ]
          }
        },
        {
          "name": "authority",
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
          "name": "targetModuleId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "flags",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setModuleImplementationActive",
      "docs": [
        "Provider kill-switch for a published implementation. Existing TRUSTs do",
        "not move automatically; this only prevents future adoption through this",
        "catalog entry."
      ],
      "discriminator": [
        52,
        9,
        109,
        183,
        21,
        228,
        117,
        72
      ],
      "accounts": [
        {
          "name": "implementation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  117,
                  108,
                  101,
                  95,
                  105,
                  109,
                  112,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "implementation.provider",
                "account": "moduleImplementation"
              },
              {
                "kind": "account",
                "path": "implementation.module_id",
                "account": "moduleImplementation"
              },
              {
                "kind": "account",
                "path": "implementation.version",
                "account": "moduleImplementation"
              }
            ]
          }
        },
        {
          "name": "provider",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setNumericConfig",
      "docs": [
        "Set a numeric config slot (u128). Authority-only in this iteration."
      ],
      "discriminator": [
        110,
        171,
        203,
        138,
        87,
        89,
        161,
        102
      ],
      "accounts": [
        {
          "name": "trust",
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
            ]
          }
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103,
                  95,
                  110,
                  117,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "key"
              }
            ]
          }
        },
        {
          "name": "sourceModule",
          "docs": [
            "Reserved for future live-mode module-auth wiring."
          ],
          "optional": true
        },
        {
          "name": "authority",
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
          "name": "key",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "value",
          "type": "u128"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Pause / unpause the TRUST. Pause blocks all mutating ops."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "trust",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "sourceModule",
          "docs": [
            "Reserved for future live-mode module-auth wiring."
          ],
          "optional": true
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "addressConfig",
      "discriminator": [
        199,
        248,
        232,
        151,
        19,
        17,
        254,
        48
      ]
    },
    {
      "name": "bytesConfig",
      "discriminator": [
        207,
        187,
        174,
        44,
        102,
        116,
        168,
        10
      ]
    },
    {
      "name": "module",
      "discriminator": [
        234,
        149,
        112,
        29,
        65,
        203,
        69,
        160
      ]
    },
    {
      "name": "moduleAclEdge",
      "discriminator": [
        211,
        101,
        119,
        110,
        91,
        224,
        45,
        44
      ]
    },
    {
      "name": "moduleImplementation",
      "discriminator": [
        62,
        17,
        83,
        229,
        18,
        123,
        89,
        78
      ]
    },
    {
      "name": "numericConfig",
      "discriminator": [
        146,
        205,
        41,
        147,
        55,
        107,
        116,
        68
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
      "name": "moduleAclSet",
      "discriminator": [
        224,
        44,
        139,
        93,
        26,
        57,
        117,
        242
      ]
    },
    {
      "name": "moduleImplementationActiveChanged",
      "discriminator": [
        230,
        108,
        8,
        245,
        185,
        117,
        188,
        253
      ]
    },
    {
      "name": "moduleImplementationAdopted",
      "discriminator": [
        196,
        180,
        187,
        89,
        65,
        48,
        209,
        229
      ]
    },
    {
      "name": "moduleImplementationPublished",
      "discriminator": [
        103,
        250,
        67,
        140,
        74,
        235,
        239,
        2
      ]
    },
    {
      "name": "moduleRegistered",
      "discriminator": [
        238,
        195,
        44,
        30,
        233,
        254,
        17,
        20
      ]
    },
    {
      "name": "trustFinalized",
      "discriminator": [
        56,
        235,
        56,
        51,
        160,
        180,
        93,
        49
      ]
    },
    {
      "name": "trustInitialized",
      "discriminator": [
        252,
        22,
        85,
        7,
        201,
        182,
        144,
        153
      ]
    },
    {
      "name": "trustPauseChanged",
      "discriminator": [
        171,
        233,
        121,
        26,
        77,
        241,
        5,
        98
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "caller is not authorized for this trust"
    },
    {
      "code": 6001,
      "name": "deniedAccess",
      "msg": "denied — caller does not hold the required ACL flag"
    },
    {
      "code": 6002,
      "name": "trustPaused",
      "msg": "trust is paused"
    },
    {
      "code": 6003,
      "name": "notInCreationMode",
      "msg": "operation is only permitted in creation mode"
    },
    {
      "code": 6004,
      "name": "alreadyFinalized",
      "msg": "trust has already been finalized"
    },
    {
      "code": 6005,
      "name": "trustNotFinalized",
      "msg": "trust must be finalized before adopting module implementations"
    },
    {
      "code": 6006,
      "name": "noModulesRegistered",
      "msg": "trust must register at least one module before finalization"
    },
    {
      "code": 6007,
      "name": "invalidImplementationVersion",
      "msg": "module implementation version must be greater than zero"
    },
    {
      "code": 6008,
      "name": "implementationProgramNotExecutable",
      "msg": "module implementation program account must be executable"
    },
    {
      "code": 6009,
      "name": "inactiveImplementation",
      "msg": "module implementation is inactive"
    },
    {
      "code": 6010,
      "name": "implementationModuleMismatch",
      "msg": "module implementation does not match the module slot"
    },
    {
      "code": 6011,
      "name": "moduleAlreadyInitialized",
      "msg": "module has already been initialized"
    },
    {
      "code": 6012,
      "name": "moduleNotInitialized",
      "msg": "module has not yet been initialized"
    },
    {
      "code": 6013,
      "name": "configTooLarge",
      "msg": "config payload exceeds maximum size"
    },
    {
      "code": 6014,
      "name": "mathOverflow",
      "msg": "math overflow"
    }
  ],
  "types": [
    {
      "name": "addressConfig",
      "docs": [
        "Address config slot. PDA seeded `[b\"cfg_addr\", trust, key]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "key",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "value",
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
      "name": "bytesConfig",
      "docs": [
        "Bytes config slot — used to carry borsh-serialized module config to",
        "`finalize`. PDA seeded `[b\"cfg_bytes\", trust, key]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "key",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "value",
            "type": "bytes"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "module",
      "docs": [
        "Per-module record under a TRUST. PDA seeded",
        "`[b\"module\", trust, module_id]`. Holds the program ID that currently",
        "implements this module slot and the bit-flag ACL for module → TRUST",
        "permissions."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "moduleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "programId",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "implementationVersion",
            "type": "u64"
          },
          {
            "name": "implementationMetadataHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "trustAcl",
            "type": "u64"
          },
          {
            "name": "initialized",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "moduleAclEdge",
      "docs": [
        "Edge in the inter-module ACL graph. PDA seeded",
        "`[b\"acl_edge\", trust, source_module_id, target_module_id]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "sourceModuleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "targetModuleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "flags",
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
      "name": "moduleAclSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "sourceModuleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "targetModuleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "flags",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "moduleImplementation",
      "docs": [
        "Provider-published implementation candidate. This is the Solana-native",
        "equivalent of the EVM beacon source catalog: providers can publish new",
        "module implementations, but each TRUST must explicitly adopt one."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "moduleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "implementationProgramId",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u64"
          },
          {
            "name": "metadataHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "active",
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
      "name": "moduleImplementationActiveChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "moduleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "moduleImplementationAdopted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "moduleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u64"
          },
          {
            "name": "implementationProgramId",
            "type": "pubkey"
          },
          {
            "name": "metadataHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "trustAcl",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "moduleImplementationPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "moduleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "u64"
          },
          {
            "name": "implementationProgramId",
            "type": "pubkey"
          },
          {
            "name": "metadataHash",
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
      "name": "moduleRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "moduleId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "programId",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "implementationVersion",
            "type": "u64"
          },
          {
            "name": "implementationMetadataHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "trustAcl",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "numericConfig",
      "docs": [
        "Numeric config slot. PDA seeded `[b\"cfg_num\", trust, key]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "key",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "value",
            "type": "u128"
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
    },
    {
      "name": "trustFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "moduleCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "trustInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
          }
        ]
      }
    },
    {
      "name": "trustPauseChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
