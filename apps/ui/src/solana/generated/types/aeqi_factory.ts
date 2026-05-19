/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_factory.json`.
 */
export type AeqiFactory = {
  "address": "3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv",
  "metadata": {
    "name": "aeqiFactory",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI on-chain DAO factory — template registry + multi-sig instantiation"
  },
  "instructions": [
    {
      "name": "createCompany",
      "docs": [
        "Skeleton create flow — initializes a fresh TRUST PDA via CPI into",
        "`aeqi_trust::initialize`. The caller becomes the trust authority.",
        "Module registration and finalization follow in `instantiate_template`."
      ],
      "discriminator": [
        36,
        192,
        217,
        147,
        233,
        129,
        198,
        18
      ],
      "accounts": [
        {
          "name": "trust",
          "docs": [
            "the PDA from `[b\"trust\", trust_id]` under its own program ID."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "aeqiTrustProgram",
          "address": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV"
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
      "name": "createCompanyFull",
      "docs": [
        "Full atomic spawn — runs the canonical 3-module configuration",
        "(role + token + governance) in one tx:",
        "",
        "1. CPI `aeqi_trust::initialize` (creates trust PDA, creation mode)",
        "2. CPI `aeqi_trust::register_module` ×3 (one per module slot)",
        "3. CPI each module's `init` (creates its module-state PDA bound",
        "to the trust)",
        "4. CPI `aeqi_trust::finalize` (exits creation mode)",
        "",
        "Module finalize CPIs (config-bytes decode) are NOT yet called here;",
        "that requires the BytesConfig dispatch flow which follows.",
        "Tx size: ~13 accounts; should fit comfortably in 1232 bytes."
      ],
      "discriminator": [
        128,
        230,
        13,
        233,
        129,
        92,
        52,
        167
      ],
      "accounts": [
        {
          "name": "trust",
          "writable": true
        },
        {
          "name": "roleModule",
          "writable": true
        },
        {
          "name": "tokenModule",
          "writable": true
        },
        {
          "name": "govModule",
          "writable": true
        },
        {
          "name": "roleModuleState",
          "writable": true
        },
        {
          "name": "tokenModuleState",
          "writable": true
        },
        {
          "name": "govModuleState",
          "writable": true
        },
        {
          "name": "tokenBytesConfig",
          "docs": [
            "BytesConfig PDA at the canonical TOKEN_CONFIG_KEY seed under",
            "aeqi_trust's program id."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "aeqiTrustProgram",
          "address": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV"
        },
        {
          "name": "aeqiRoleProgram",
          "address": "4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB"
        },
        {
          "name": "aeqiTokenProgram",
          "address": "AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh"
        },
        {
          "name": "aeqiGovernanceProgram",
          "address": "5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq"
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
        },
        {
          "name": "roleModuleId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "tokenModuleId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "govModuleId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "roleAcl",
          "type": "u64"
        },
        {
          "name": "tokenAcl",
          "type": "u64"
        },
        {
          "name": "govAcl",
          "type": "u64"
        },
        {
          "name": "tokenDecimals",
          "type": "u8"
        },
        {
          "name": "tokenMaxSupplyCap",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createWithModules",
      "docs": [
        "Partial spawn — initialize a fresh trust and register a module set,",
        "**leaving the trust in creation mode** so the caller can run each",
        "module's `init` CPI before finalizing. Use this when the caller",
        "owns the module-init step (the canonical use case is an off-chain",
        "provisioner that submits init CPIs in follow-up transactions);",
        "for the fully-atomic role + token + governance shape, prefer",
        "`create_company_full`, which packs init + register + module-init",
        "+ finalize into one transaction.",
        "",
        "Steps:",
        "",
        "1. CPI `aeqi_trust::initialize` (creates Trust PDA in creation mode).",
        "2. For each `ModuleSpec` in `modules`, CPI `aeqi_trust::register_module`.",
        "The matching module PDAs are passed in `remaining_accounts`.",
        "",
        "**Does NOT finalize.** Earlier versions of this function called",
        "`aeqi_trust::finalize` at step 3, which locked out every",
        "subsequent module init — `aeqi_*::init` requires the trust be in",
        "creation mode. Callers that need register + per-module init +",
        "finalize MUST issue the finalize CPI themselves once the inits",
        "land. Cost of the prior shape (2026-05-17): every off-chain",
        "trust-provisioning attempt failed with `TrustNotInCreationMode`",
        "because the factory finalized before the inits could run.",
        "",
        "`remaining_accounts` layout: for each module spec, push the module PDA",
        "(writable, will be initialized by `aeqi_trust`).",
        "",
        "The caller (the `authority`) signs all CPIs as the trust authority."
      ],
      "discriminator": [
        28,
        171,
        175,
        188,
        0,
        110,
        145,
        93
      ],
      "accounts": [
        {
          "name": "trust",
          "docs": [
            "`[b\"trust\", trust_id]` under its own program ID."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "aeqiTrustProgram",
          "address": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV"
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
        },
        {
          "name": "modules",
          "type": {
            "vec": {
              "defined": {
                "name": "moduleSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "instantiateTemplate",
      "docs": [
        "Template-driven partial create flow: reads a registered Template PDA",
        "and replays its module set against a fresh TRUST. **Leaves the trust",
        "in creation mode** so the caller can run each module's `init` CPI",
        "before finalizing.",
        "",
        "`remaining_accounts` layout:",
        "",
        "1. one Module PDA per module in template order",
        "2. one ModuleImplementation PDA per module in template order",
        "3. one ModuleAclEdge PDA per ACL edge in template order",
        "",
        "Steps:",
        "1. CPI aeqi_trust::initialize (creates trust, enters creation mode)",
        "2. Validate each ModuleSpec against its provider-published",
        "ModuleImplementation PDA",
        "3. For each ModuleSpec in template.modules: CPI register_module",
        "4. For each AclEdgeSpec in template.acl_edges: CPI set_module_acl",
        "",
        "**Does NOT finalize.** Earlier versions called `aeqi_trust::finalize`",
        "at step 5, which locked out every subsequent module init — modules",
        "require the trust be in creation mode for their per-module `init`",
        "CPI to succeed. Callers that need register + per-module init +",
        "finalize MUST issue the finalize CPI themselves once all the inits",
        "have landed. Same bug class as the prior `create_with_modules`",
        "shape (fix shipped 2026-05-17 b7173c8c); applying it here closes",
        "the lookalike before templates go live in the field."
      ],
      "discriminator": [
        253,
        104,
        179,
        115,
        53,
        208,
        231,
        0
      ],
      "accounts": [
        {
          "name": "template",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  109,
                  112,
                  108,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "template.template_id",
                "account": "template"
              }
            ]
          }
        },
        {
          "name": "trust",
          "docs": [
            "`[b\"trust\", trust_id]` under its own program ID."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "aeqiTrustProgram",
          "address": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV"
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
      "name": "registerTemplate",
      "docs": [
        "Register a template — stores the module set, ACL graph, and admin so",
        "`instantiate_template` can later replay this against a fresh TRUST."
      ],
      "discriminator": [
        174,
        125,
        229,
        78,
        140,
        171,
        67,
        131
      ],
      "accounts": [
        {
          "name": "template",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  109,
                  112,
                  108,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "templateId"
              }
            ]
          }
        },
        {
          "name": "admin",
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
          "name": "templateId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "modules",
          "type": {
            "vec": {
              "defined": {
                "name": "moduleSpec"
              }
            }
          }
        },
        {
          "name": "aclEdges",
          "type": {
            "vec": {
              "defined": {
                "name": "aclEdgeSpec"
              }
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "template",
      "discriminator": [
        43,
        26,
        88,
        69,
        69,
        96,
        9,
        79
      ]
    }
  ],
  "events": [
    {
      "name": "companyCreated",
      "discriminator": [
        183,
        208,
        141,
        81,
        6,
        83,
        112,
        99
      ]
    },
    {
      "name": "companyFullySpawned",
      "discriminator": [
        144,
        105,
        45,
        176,
        58,
        51,
        94,
        96
      ]
    },
    {
      "name": "companySpawned",
      "discriminator": [
        234,
        60,
        207,
        225,
        211,
        192,
        82,
        170
      ]
    },
    {
      "name": "templateInstantiated",
      "discriminator": [
        40,
        29,
        130,
        198,
        87,
        129,
        168,
        129
      ]
    },
    {
      "name": "templateRegistered",
      "discriminator": [
        108,
        218,
        84,
        231,
        122,
        114,
        35,
        20
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "emptyModuleSet",
      "msg": "template must declare at least one module"
    },
    {
      "code": 6001,
      "name": "tooManyModules",
      "msg": "template module set exceeds maximum (16)"
    },
    {
      "code": 6002,
      "name": "tooManyAclEdges",
      "msg": "template ACL edges exceed maximum (64)"
    },
    {
      "code": 6003,
      "name": "moduleAccountCountMismatch",
      "msg": "remaining_accounts.len() must equal modules.len()"
    },
    {
      "code": 6004,
      "name": "templateAccountCountMismatch",
      "msg": "remaining_accounts must include module, implementation, and ACL-edge accounts"
    },
    {
      "code": 6005,
      "name": "duplicateModuleId",
      "msg": "template module ids must be unique"
    },
    {
      "code": 6006,
      "name": "unknownAclModuleReference",
      "msg": "template ACL edge references unknown module id"
    },
    {
      "code": 6007,
      "name": "invalidImplementationVersion",
      "msg": "template module implementation version must be greater than zero"
    },
    {
      "code": 6008,
      "name": "implementationAccountMismatch",
      "msg": "template module implementation account does not match the module spec"
    },
    {
      "code": 6009,
      "name": "inactiveImplementation",
      "msg": "template module implementation is inactive"
    }
  ],
  "types": [
    {
      "name": "aclEdgeSpec",
      "docs": [
        "Inter-module ACL edge declaration. After all modules are deployed the",
        "factory walks this list and CPIs `aeqi_trust::set_module_acl` per edge."
      ],
      "type": {
        "kind": "struct",
        "fields": [
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
      "name": "companyCreated",
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
      "name": "companyFullySpawned",
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
      "name": "companySpawned",
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
          },
          {
            "name": "moduleCount",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "moduleSpec",
      "docs": [
        "Module declaration in a template. `program_id` points at the concrete",
        "executable selected for this template. `provider`, `implementation_version`,",
        "and `implementation_metadata_hash` record the provider-published version",
        "that this TRUST starts from; future provider releases are adopted per TRUST."
      ],
      "type": {
        "kind": "struct",
        "fields": [
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
      "name": "template",
      "docs": [
        "Template registered on-chain. PDA seeded `[b\"template\", template_id]`.",
        "Declares the module set, ACL graph, and default value configs that",
        "`instantiate_template` will replay against every fresh TRUST."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "templateId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "modules",
            "type": {
              "vec": {
                "defined": {
                  "name": "moduleSpec"
                }
              }
            }
          },
          {
            "name": "aclEdges",
            "type": {
              "vec": {
                "defined": {
                  "name": "aclEdgeSpec"
                }
              }
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
      "name": "templateInstantiated",
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
            "name": "templateId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "moduleCount",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "templateRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "templateId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "moduleCount",
            "type": "u8"
          },
          {
            "name": "aclEdgeCount",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
