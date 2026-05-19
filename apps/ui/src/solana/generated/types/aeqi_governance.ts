/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_governance.json`.
 */
export type AeqiGovernance = {
  "address": "5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq",
  "metadata": {
    "name": "aeqiGovernance",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Governance module — proposals, voting (token + per-role multisig)"
  },
  "instructions": [
    {
      "name": "castVote",
      "docs": [
        "Deprecated compatibility entrypoint. Generic votes are disabled because",
        "caller-supplied weight is not tied to token or role state. Use",
        "`cast_vote_token` or `cast_vote_role` instead."
      ],
      "discriminator": [
        20,
        212,
        15,
        189,
        69,
        180,
        69,
        151
      ],
      "accounts": [
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "vote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "voter",
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
          "name": "choice",
          "type": "u8"
        },
        {
          "name": "weight",
          "type": "u128"
        }
      ]
    },
    {
      "name": "castVoteRole",
      "docs": [
        "Cast a per-role-multisig vote. Vote power = the voter's",
        "`RoleVoteCheckpoint.count` for the role type designated by the",
        "proposal's governance_config_id. The checkpoint PDA is owned by",
        "`aeqi_role`; we validate its `account` field == voter."
      ],
      "discriminator": [
        1,
        211,
        81,
        6,
        135,
        120,
        47,
        183
      ],
      "accounts": [
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "vote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "voterCheckpoint",
          "docs": [
            "derivation is enforced by `seeds::program = AEQI_ROLE_ID`; the",
            "handler verifies ownership and borsh-decodes the data manually."
          ],
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
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.governance_config_id",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                48,
                136,
                3,
                124,
                211,
                218,
                77,
                222,
                170,
                29,
                39,
                92,
                110,
                6,
                117,
                229,
                6,
                93,
                28,
                121,
                110,
                22,
                142,
                63,
                7,
                158,
                190,
                40,
                18,
                177,
                106,
                48
              ]
            }
          }
        },
        {
          "name": "voter",
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
          "name": "choice",
          "type": "u8"
        }
      ]
    },
    {
      "name": "castVoteToken",
      "docs": [
        "Cast a token-weighted vote against the proposal's Merkle snapshot",
        "(Phase 2 — see idea design/aeqi-governance-proposal-start-snapshots).",
        "`claimed_balance` is the voter's Token-2022 balance at",
        "`proposal.snapshot_slot`, attested by a Merkle inclusion proof",
        "against `proposal.snapshot_root`. The `vote_record` PDA's",
        "`init` constraint blocks double-voting per (proposal, voter).",
        "",
        "Snapshot must already be committed (`commit_snapshot_root`); voting",
        "with the pre-commitment zero root is rejected to keep the proposal",
        "from being decided against live balances."
      ],
      "discriminator": [
        204,
        8,
        218,
        150,
        34,
        179,
        153,
        30
      ],
      "accounts": [
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "vote",
          "docs": [
            "Single-vote-per-voter gate. `init` rejects a second cast with",
            "\"already in use\", which is the desired error from a UX standpoint",
            "and saves us a separate `DoubleVote` error variant."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "voter",
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
          "name": "choice",
          "type": "u8"
        },
        {
          "name": "claimedBalance",
          "type": "u64"
        },
        {
          "name": "merkleProof",
          "type": {
            "vec": {
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
      "name": "commitSnapshotRoot",
      "docs": [
        "Commit a Merkle root over (holder, balance) leaves snapshotted at",
        "`proposal.snapshot_slot`. Permissionless — anyone (typically the",
        "off-chain indexer's snapshot job) can call it once per proposal.",
        "",
        "Guards:",
        "- existing root must be zero (one-shot commit)",
        "- current slot must be STRICTLY greater than `snapshot_slot` so",
        "the snapshotter has only ever seen finalized balances at the",
        "target slot (prevents racing mints/burns at the same slot)",
        "",
        "`total_supply_snapshot` is recorded as protocol metadata; per-vote",
        "correctness is enforced by Merkle proof verification in",
        "`cast_vote_token`, not by trusting the caller's totals."
      ],
      "discriminator": [
        115,
        95,
        163,
        40,
        28,
        93,
        67,
        37
      ],
      "accounts": [
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "committer",
          "docs": [
            "Permissionless caller — the snapshot job pays rent for the tx and",
            "the program enforces one-shot via `proposal.snapshot_root == [0; 32]`."
          ],
          "signer": true
        }
      ],
      "args": [
        {
          "name": "root",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "totalSupplySnapshot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "executeProposal",
      "docs": [
        "Execute a proposal that has succeeded. Validates:",
        "- voting period has ended (or early enact + thresholds met)",
        "- quorum: (for + abstain) ≥ ceil(totalVoteSupply * quorum_bps / 10000)",
        "- support: for ≥ ceil((for + against) * support_bps / 10000)",
        "",
        "Remaining accounts:",
        "0. `GovernanceConfig` PDA matching `proposal.governance_config_id`",
        "1. vote supply source:",
        "- token mode (`[0; 32]` config): canonical cap-table mint PDA",
        "- role mode: canonical `aeqi_role::RoleType` PDA",
        "",
        "On-chain ix dispatch (running the proposed action via remaining_accounts)",
        "is reserved for a follow-up — this iteration just transitions",
        "Proposal.executed → true after threshold gate."
      ],
      "discriminator": [
        186,
        60,
        116,
        133,
        108,
        128,
        111,
        28
      ],
      "accounts": [
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.trust",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.proposal_id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "executor",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "finalize",
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
          "name": "trust"
        }
      ],
      "args": []
    },
    {
      "name": "init",
      "docs": [
        "Module init — creates GovernanceModuleState PDA bound to a trust.",
        "Gated to the trust authority during creation mode so the",
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
                  103,
                  111,
                  118,
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
      "name": "propose",
      "docs": [
        "Create a proposal under a registered governance config. Per-proposal",
        "mode selection via `governance_config_id`."
      ],
      "discriminator": [
        93,
        253,
        82,
        168,
        118,
        33,
        102,
        90
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
                  103,
                  111,
                  118,
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
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "proposalId"
              }
            ]
          }
        },
        {
          "name": "proposer",
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
          "name": "proposalId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "governanceConfigId",
          "type": {
            "array": [
              "u8",
              32
            ]
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
      "name": "registerConfig",
      "docs": [
        "Register a governance config (one per voting mode the trust supports).",
        "Authority gate: only the trust authority can register configs in this",
        "iteration. Once live-mode governance lands, ratified config changes",
        "will flow through `execute_proposal`."
      ],
      "discriminator": [
        32,
        247,
        82,
        131,
        35,
        183,
        7,
        57
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
                  103,
                  111,
                  118,
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
          "name": "governanceConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "governanceConfigId"
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
          "name": "governanceConfigId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "governanceConfigInput"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "governanceConfig",
      "discriminator": [
        81,
        63,
        124,
        107,
        210,
        100,
        145,
        70
      ]
    },
    {
      "name": "governanceModuleState",
      "discriminator": [
        75,
        105,
        160,
        100,
        119,
        40,
        145,
        36
      ]
    },
    {
      "name": "proposal",
      "discriminator": [
        26,
        94,
        189,
        187,
        116,
        136,
        53,
        33
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
    },
    {
      "name": "voteRecord",
      "discriminator": [
        112,
        9,
        123,
        165,
        234,
        9,
        157,
        167
      ]
    }
  ],
  "events": [
    {
      "name": "configRegistered",
      "discriminator": [
        47,
        118,
        118,
        46,
        127,
        73,
        178,
        4
      ]
    },
    {
      "name": "proposalCreated",
      "discriminator": [
        186,
        8,
        160,
        108,
        81,
        13,
        51,
        206
      ]
    },
    {
      "name": "proposalExecuted",
      "discriminator": [
        92,
        213,
        189,
        201,
        101,
        83,
        111,
        83
      ]
    },
    {
      "name": "snapshotRootCommitted",
      "discriminator": [
        244,
        146,
        243,
        218,
        20,
        5,
        40,
        198
      ]
    },
    {
      "name": "voteCast",
      "discriminator": [
        39,
        53,
        195,
        104,
        188,
        17,
        225,
        213
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidBpsValue",
      "msg": "bps value must be between 1 and 10000 (0.01%–100.00%)"
    },
    {
      "code": 6001,
      "name": "zeroVotingPeriod",
      "msg": "voting_period must be > 0"
    },
    {
      "code": 6002,
      "name": "configMismatch",
      "msg": "governance_config_id mismatch — config PDA doesn't match the id passed"
    },
    {
      "code": 6003,
      "name": "invalidVoteChoice",
      "msg": "vote choice must be 0 (against), 1 (for), or 2 (abstain)"
    },
    {
      "code": 6004,
      "name": "zeroWeight",
      "msg": "vote weight must be > 0"
    },
    {
      "code": 6005,
      "name": "genericVotingDisabled",
      "msg": "generic caller-supplied vote weights are disabled; use token or role voting"
    },
    {
      "code": 6006,
      "name": "proposalAlreadyExecuted",
      "msg": "proposal has already been executed"
    },
    {
      "code": 6007,
      "name": "proposalCanceled",
      "msg": "proposal was canceled"
    },
    {
      "code": 6008,
      "name": "votingNotStarted",
      "msg": "voting has not yet started for this proposal"
    },
    {
      "code": 6009,
      "name": "votingClosed",
      "msg": "voting has closed for this proposal"
    },
    {
      "code": 6010,
      "name": "votingNotClosed",
      "msg": "voting has not yet closed and config does not allow early enact"
    },
    {
      "code": 6011,
      "name": "quorumNotMet",
      "msg": "quorum threshold not met"
    },
    {
      "code": 6012,
      "name": "noDecisiveVotes",
      "msg": "no decisive votes (for + against = 0)"
    },
    {
      "code": 6013,
      "name": "supportNotMet",
      "msg": "support threshold not met"
    },
    {
      "code": 6014,
      "name": "executionDelayNotMet",
      "msg": "execution delay has not yet elapsed"
    },
    {
      "code": 6015,
      "name": "checkpointVoterMismatch",
      "msg": "voter_checkpoint.account != voter signer"
    },
    {
      "code": 6016,
      "name": "invalidCheckpoint",
      "msg": "voter_checkpoint is not owned by aeqi_role or has invalid layout"
    },
    {
      "code": 6017,
      "name": "checkpointAfterSnapshot",
      "msg": "voter_checkpoint.slot is newer than proposal.snapshot_slot"
    },
    {
      "code": 6018,
      "name": "missingVoteSupplyAccount",
      "msg": "execute_proposal requires a canonical vote supply account"
    },
    {
      "code": 6019,
      "name": "voteSupplyAccountMismatch",
      "msg": "vote supply account does not match the proposal voting mode"
    },
    {
      "code": 6020,
      "name": "invalidVoteSupplyAccount",
      "msg": "vote supply account has invalid owner or layout"
    },
    {
      "code": 6021,
      "name": "zeroVoteSupply",
      "msg": "vote supply must be > 0"
    },
    {
      "code": 6022,
      "name": "mathOverflow",
      "msg": "math overflow"
    },
    {
      "code": 6023,
      "name": "unauthorized",
      "msg": "caller is not authorized for this trust"
    },
    {
      "code": 6024,
      "name": "trustNotInCreationMode",
      "msg": "trust must be in creation mode to initialize the governance module"
    },
    {
      "code": 6025,
      "name": "commitRootMismatch",
      "msg": "snapshot_root already committed for this proposal (one-shot)"
    },
    {
      "code": 6026,
      "name": "snapshotNotCommitted",
      "msg": "snapshot_root not yet committed — wait for the snapshotter to run"
    },
    {
      "code": 6027,
      "name": "invalidMerkleProof",
      "msg": "merkle proof does not verify against proposal.snapshot_root"
    },
    {
      "code": 6028,
      "name": "snapshotSlotNotYetReached",
      "msg": "snapshot_slot not yet finalized — wait for current_slot > snapshot_slot"
    }
  ],
  "types": [
    {
      "name": "configRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "governanceConfigId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "quorumBps",
            "type": "u16"
          },
          {
            "name": "supportBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "governanceConfig",
      "docs": [
        "One per voting mode."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "governanceConfigId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proposalThreshold",
            "type": "u128"
          },
          {
            "name": "quorumBps",
            "type": "u16"
          },
          {
            "name": "supportBps",
            "type": "u16"
          },
          {
            "name": "votingPeriod",
            "type": "i64"
          },
          {
            "name": "executionDelay",
            "type": "i64"
          },
          {
            "name": "allowEarlyEnact",
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
      "name": "governanceConfigInput",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposalThreshold",
            "type": "u128"
          },
          {
            "name": "quorumBps",
            "type": "u16"
          },
          {
            "name": "supportBps",
            "type": "u16"
          },
          {
            "name": "votingPeriod",
            "type": "i64"
          },
          {
            "name": "executionDelay",
            "type": "i64"
          },
          {
            "name": "allowEarlyEnact",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "governanceModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "proposalCount",
            "type": "u64"
          },
          {
            "name": "configCount",
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
      "name": "proposal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "governanceConfigId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proposer",
            "type": "pubkey"
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
            "name": "voteStart",
            "type": "i64"
          },
          {
            "name": "voteDuration",
            "type": "i64"
          },
          {
            "name": "executionDelay",
            "type": "i64"
          },
          {
            "name": "snapshotSlot",
            "docs": [
              "Solana slot captured at `propose()` time. `cast_vote_role` rejects",
              "any RoleVoteCheckpoint whose `slot` is greater than this — locking",
              "vote power to delegations held when the proposal opened. Phase 1",
              "of design/aeqi-governance-proposal-start-snapshots; Phase 2 (ae-008)",
              "reuses the same slot for token Merkle snapshots."
            ],
            "type": "u64"
          },
          {
            "name": "snapshotRoot",
            "docs": [
              "Merkle root over (holder_pubkey, balance) leaves at",
              "`snapshot_slot`, committed once by `commit_snapshot_root` (Phase 2,",
              "ae-008). Initialized to `[0; 32]` at `propose()`; `cast_vote_token`",
              "rejects votes until the indexer's snapshot job commits the real",
              "root."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "snapshotTotalSupply",
            "docs": [
              "Sum of all holder balances at `snapshot_slot`, published alongside",
              "`snapshot_root` for downstream quorum/supply reporting. Not used",
              "in per-vote enforcement (Merkle proofs are the gate); kept as",
              "protocol metadata."
            ],
            "type": "u64"
          },
          {
            "name": "forVotes",
            "type": "u128"
          },
          {
            "name": "againstVotes",
            "type": "u128"
          },
          {
            "name": "abstainVotes",
            "type": "u128"
          },
          {
            "name": "executed",
            "type": "bool"
          },
          {
            "name": "canceled",
            "type": "bool"
          },
          {
            "name": "succeededAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "proposalCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "governanceConfigId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "voteStart",
            "type": "i64"
          },
          {
            "name": "voteDuration",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "proposalExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "forVotes",
            "type": "u128"
          },
          {
            "name": "againstVotes",
            "type": "u128"
          },
          {
            "name": "abstainVotes",
            "type": "u128"
          },
          {
            "name": "executedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "snapshotRootCommitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "snapshotSlot",
            "type": "u64"
          },
          {
            "name": "snapshotRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalSupplySnapshot",
            "type": "u64"
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
      "name": "voteCast",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "voter",
            "type": "pubkey"
          },
          {
            "name": "choice",
            "type": "u8"
          },
          {
            "name": "weight",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "voteRecord",
      "docs": [
        "One per (proposal, voter) pair — init enforces single-vote-per-voter."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "voter",
            "type": "pubkey"
          },
          {
            "name": "choice",
            "type": "u8"
          },
          {
            "name": "weight",
            "type": "u128"
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
