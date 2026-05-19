/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aeqi_unifutures.json`.
 */
export type AeqiUnifutures = {
  "address": "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF",
  "metadata": {
    "name": "aeqiUnifutures",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AEQI Unifutures — bonding curves, commitment sales, exits, liquidity pools"
  },
  "instructions": [
    {
      "name": "addLiquidity",
      "docs": [
        "Add liquidity to the internal pool. For the first deposit, the",
        "pool mints `sqrt(base * quote)` LP shares. For later deposits, the",
        "amounts are capped to the pool's current ratio and LP shares are",
        "minted pro-rata."
      ],
      "discriminator": [
        181,
        157,
        89,
        67,
        143,
        182,
        52,
        72
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108,
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
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "lpMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "providerBaseTa",
          "writable": true
        },
        {
          "name": "providerQuoteTa",
          "writable": true
        },
        {
          "name": "providerLpTa",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "quoteVault",
          "writable": true
        },
        {
          "name": "provider",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "baseAmount",
          "type": "u64"
        },
        {
          "name": "quoteAmount",
          "type": "u64"
        },
        {
          "name": "minLpOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buyFromCurve",
      "docs": [
        "Buy `token_amount` of asset from the curve. Buyer pays `cost` of",
        "quote tokens (computed from the curve), receives `token_amount` of",
        "asset tokens from the program-controlled curve_asset_vault.",
        "`max_cost` is slippage protection — reverts if cost exceeds it."
      ],
      "discriminator": [
        220,
        94,
        173,
        236,
        129,
        110,
        23,
        21
      ],
      "accounts": [
        {
          "name": "curve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "curve.trust",
                "account": "bondingCurve"
              },
              {
                "kind": "account",
                "path": "curve.curve_id",
                "account": "bondingCurve"
              }
            ]
          }
        },
        {
          "name": "curveAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
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
                "path": "curve.trust",
                "account": "bondingCurve"
              },
              {
                "kind": "account",
                "path": "curve.curve_id",
                "account": "bondingCurve"
              }
            ]
          }
        },
        {
          "name": "assetMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "curveAssetVault",
          "writable": true
        },
        {
          "name": "curveQuoteVault",
          "writable": true
        },
        {
          "name": "buyerAssetTa",
          "writable": true
        },
        {
          "name": "buyerQuoteTa",
          "writable": true
        },
        {
          "name": "buyer",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "tokenAmount",
          "type": "u64"
        },
        {
          "name": "maxCost",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimAllocation",
      "docs": [
        "Claim a buyer's pro-rata asset allocation from a Completed sale.",
        "allocation = commitment.amount * asset_amount / commitments_collected.",
        "Assets are transferred from the pre-loaded sale_asset_vault."
      ],
      "discriminator": [
        19,
        148,
        128,
        46,
        220,
        171,
        177,
        43
      ],
      "accounts": [
        {
          "name": "sale",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "sale.trust",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "sale.sale_id",
                "account": "commitmentSale"
              }
            ]
          }
        },
        {
          "name": "saleAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  108,
                  101,
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
                "path": "sale.trust",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "sale.sale_id",
                "account": "commitmentSale"
              }
            ]
          }
        },
        {
          "name": "assetMint"
        },
        {
          "name": "saleAssetVault",
          "writable": true
        },
        {
          "name": "commitment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  108,
                  101,
                  95,
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sale.trust",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "sale.sale_id",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "buyerAssetTa",
          "writable": true
        },
        {
          "name": "buyer",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimProRata",
      "docs": [
        "Claim a pro-rata share of an Exit's proceeds by burning cap-table",
        "tokens. Burns `burn_amount` of asset; receives",
        "`burn_amount * exit_quote / total_supply_snapshot` of quote."
      ],
      "discriminator": [
        36,
        219,
        224,
        91,
        23,
        111,
        51,
        85
      ],
      "accounts": [
        {
          "name": "exit",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "exit.trust",
                "account": "exit"
              },
              {
                "kind": "account",
                "path": "exit.exit_id",
                "account": "exit"
              }
            ]
          }
        },
        {
          "name": "exitAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  105,
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
                "path": "exit.trust",
                "account": "exit"
              },
              {
                "kind": "account",
                "path": "exit.exit_id",
                "account": "exit"
              }
            ]
          }
        },
        {
          "name": "assetMint",
          "docs": [
            "Must equal the exit's canonical asset mint pinned at create time —",
            "closes the worthless-token drain vector (Explorer A 67-162.4)."
          ],
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "exitQuoteVault",
          "writable": true
        },
        {
          "name": "holderAssetTa",
          "writable": true
        },
        {
          "name": "holderQuoteTa",
          "writable": true
        },
        {
          "name": "holder",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "burnAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "commitToSale",
      "docs": [
        "Commit quote to a CommitmentSale during its active phase. Transfers",
        "`amount` of quote to the sale's vault and records the buyer's",
        "commitment so they can claim asset allocations at finalize."
      ],
      "discriminator": [
        98,
        18,
        131,
        176,
        205,
        112,
        22,
        106
      ],
      "accounts": [
        {
          "name": "sale",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "sale.trust",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "sale.sale_id",
                "account": "commitmentSale"
              }
            ]
          }
        },
        {
          "name": "saleAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  108,
                  101,
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
                "path": "sale.trust",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "sale.sale_id",
                "account": "commitmentSale"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "saleQuoteVault",
          "writable": true
        },
        {
          "name": "buyerQuoteTa",
          "writable": true
        },
        {
          "name": "commitment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  108,
                  101,
                  95,
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sale.trust",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "sale.sale_id",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "buyer",
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
      "name": "createCommitmentSale",
      "docs": [
        "Create a CommitmentSale — fixed-price pre-sale. Buyers commit quote",
        "during the active phase; on finalization, allocations are computed",
        "against the target. Buy/finalize/claim ixes follow."
      ],
      "discriminator": [
        6,
        110,
        230,
        191,
        107,
        209,
        228,
        100
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
                  117,
                  110,
                  105,
                  102,
                  117,
                  116,
                  117,
                  114,
                  101,
                  115,
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
          "name": "sale",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
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
                "path": "saleId"
              }
            ]
          }
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
          "name": "saleId",
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
      "name": "createCurve",
      "docs": [
        "Create a bonding curve. Curve config is immutable after creation.",
        "`max_supply > 0` is enforced. Rising and falling curves are both",
        "supported by the math."
      ],
      "discriminator": [
        169,
        235,
        221,
        223,
        65,
        109,
        120,
        183
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
                  117,
                  110,
                  105,
                  102,
                  117,
                  116,
                  117,
                  114,
                  101,
                  115,
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
          "name": "curve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "curveId"
              }
            ]
          }
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
      "name": "createExit",
      "docs": [
        "Create an Exit — pro-rata redemption event. The acquirer (creator)",
        "commits `exit_quote` upfront; existing token holders burn their",
        "cap-table tokens to claim their pro-rata share of the proceeds pool.",
        "Settle/claim ixes follow.",
        "",
        "The canonical `asset_mint` is pinned on the Exit account at create",
        "time, and `total_supply_snapshot` is verified to equal the mint's",
        "current `supply`. claim_pro_rata then enforces that the same mint",
        "is burned, closing the worthless-token drain vector."
      ],
      "discriminator": [
        1,
        114,
        178,
        209,
        20,
        14,
        9,
        160
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
                  117,
                  110,
                  105,
                  102,
                  117,
                  116,
                  117,
                  114,
                  101,
                  115,
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
          "name": "exit",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "exitId"
              }
            ]
          }
        },
        {
          "name": "assetMint",
          "docs": [
            "Canonical asset mint for this exit. Pinned onto `exit.asset_mint`",
            "and used to snapshot total supply at creation time. claim_pro_rata",
            "later refuses any other mint."
          ]
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
      "name": "createLiquidityPool",
      "docs": [
        "Create an internal constant-product pool. The pool is empty at",
        "creation time; liquidity is seeded by later add_liquidity calls."
      ],
      "discriminator": [
        175,
        75,
        181,
        165,
        224,
        254,
        6,
        131
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
                  117,
                  110,
                  105,
                  102,
                  117,
                  116,
                  117,
                  114,
                  101,
                  115,
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
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "poolId"
              }
            ]
          }
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108,
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
              },
              {
                "kind": "arg",
                "path": "poolId"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "lpMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "trust"
              },
              {
                "kind": "arg",
                "path": "poolId"
              }
            ]
          }
        },
        {
          "name": "baseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "poolAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "poolAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "poolId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "finalizeSale",
      "docs": [
        "Finalize a CommitmentSale — closes the active phase, marks Completed",
        "so claim_allocation can run. Anyone can call after `end_time`; the",
        "creator can call any time if `proceeds_collected >= target_quote`."
      ],
      "discriminator": [
        62,
        138,
        254,
        160,
        192,
        113,
        177,
        58
      ],
      "accounts": [
        {
          "name": "sale",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "sale.trust",
                "account": "commitmentSale"
              },
              {
                "kind": "account",
                "path": "sale.sale_id",
                "account": "commitmentSale"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "init",
      "docs": [
        "Module init — creates UnifuturesModuleState PDA bound to a trust.",
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
                  117,
                  110,
                  105,
                  102,
                  117,
                  116,
                  117,
                  114,
                  101,
                  115,
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
      "name": "quoteBuy",
      "docs": [
        "Read-only — quotes the cost to buy `token_amount` at the curve's",
        "current state. Useful for client-side previews; on-chain just",
        "returns the value via the program's logged return."
      ],
      "discriminator": [
        83,
        9,
        231,
        110,
        146,
        31,
        40,
        12
      ],
      "accounts": [
        {
          "name": "curve"
        }
      ],
      "args": [
        {
          "name": "tokenAmount",
          "type": "u64"
        }
      ],
      "returns": "u128"
    },
    {
      "name": "removeLiquidity",
      "docs": [
        "Remove liquidity from the internal pool by burning LP shares and",
        "returning the proportional base/quote reserves."
      ],
      "discriminator": [
        80,
        85,
        209,
        72,
        24,
        206,
        177,
        108
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108,
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
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "lpMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "providerLpTa",
          "writable": true
        },
        {
          "name": "providerBaseTa",
          "writable": true
        },
        {
          "name": "providerQuoteTa",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "quoteVault",
          "writable": true
        },
        {
          "name": "provider",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "lpAmount",
          "type": "u64"
        },
        {
          "name": "minBaseOut",
          "type": "u64"
        },
        {
          "name": "minQuoteOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sellToCurve",
      "docs": [
        "Sell `token_amount` of asset back to the curve. Seller burns asset",
        "(transfers back to curve vault), receives `return_amount` of quote",
        "from the curve_quote_vault — reserve_ratio applied (default 90%).",
        "`min_return` is slippage protection."
      ],
      "discriminator": [
        165,
        201,
        202,
        47,
        3,
        110,
        189,
        200
      ],
      "accounts": [
        {
          "name": "curve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "curve.trust",
                "account": "bondingCurve"
              },
              {
                "kind": "account",
                "path": "curve.curve_id",
                "account": "bondingCurve"
              }
            ]
          }
        },
        {
          "name": "curveAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
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
                "path": "curve.trust",
                "account": "bondingCurve"
              },
              {
                "kind": "account",
                "path": "curve.curve_id",
                "account": "bondingCurve"
              }
            ]
          }
        },
        {
          "name": "assetMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "curveAssetVault",
          "writable": true
        },
        {
          "name": "curveQuoteVault",
          "writable": true
        },
        {
          "name": "sellerAssetTa",
          "writable": true
        },
        {
          "name": "sellerQuoteTa",
          "writable": true
        },
        {
          "name": "seller",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "tokenAmount",
          "type": "u64"
        },
        {
          "name": "minReturn",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleExit",
      "docs": [
        "Settle an Exit — creator (acquirer) deposits the full `exit_quote`",
        "into the exit's vault upfront, locking the proceeds pool. Token",
        "holders can then claim_pro_rata by burning their cap-table tokens."
      ],
      "discriminator": [
        14,
        251,
        137,
        151,
        207,
        13,
        166,
        114
      ],
      "accounts": [
        {
          "name": "exit",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "exit.trust",
                "account": "exit"
              },
              {
                "kind": "account",
                "path": "exit.exit_id",
                "account": "exit"
              }
            ]
          }
        },
        {
          "name": "exitAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  105,
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
                "path": "exit.trust",
                "account": "exit"
              },
              {
                "kind": "account",
                "path": "exit.exit_id",
                "account": "exit"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "exitQuoteVault",
          "writable": true
        },
        {
          "name": "creatorQuoteTa",
          "writable": true
        },
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "swapExactIn",
      "docs": [
        "Swap exact input against the constant-product pool. Direction is",
        "0 = base → quote, 1 = quote → base."
      ],
      "discriminator": [
        104,
        104,
        131,
        86,
        161,
        189,
        180,
        216
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  113,
                  117,
                  105,
                  100,
                  105,
                  116,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108,
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
                "path": "pool.trust",
                "account": "liquidityPool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "liquidityPool"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "traderBaseTa",
          "writable": true
        },
        {
          "name": "traderQuoteTa",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "quoteVault",
          "writable": true
        },
        {
          "name": "trader",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "direction",
          "type": "u8"
        },
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minOut",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bondingCurve",
      "discriminator": [
        23,
        183,
        248,
        55,
        96,
        216,
        172,
        96
      ]
    },
    {
      "name": "commitmentSale",
      "discriminator": [
        235,
        246,
        141,
        208,
        183,
        146,
        24,
        246
      ]
    },
    {
      "name": "exit",
      "discriminator": [
        25,
        25,
        160,
        223,
        53,
        155,
        170,
        162
      ]
    },
    {
      "name": "liquidityPool",
      "discriminator": [
        66,
        38,
        17,
        64,
        188,
        80,
        68,
        129
      ]
    },
    {
      "name": "saleCommitment",
      "discriminator": [
        224,
        167,
        92,
        37,
        222,
        94,
        102,
        11
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
      "name": "unifuturesModuleState",
      "discriminator": [
        5,
        229,
        167,
        81,
        123,
        76,
        50,
        250
      ]
    }
  ],
  "events": [
    {
      "name": "allocationClaimed",
      "discriminator": [
        21,
        221,
        147,
        215,
        183,
        47,
        37,
        188
      ]
    },
    {
      "name": "curveBuy",
      "discriminator": [
        225,
        49,
        207,
        252,
        44,
        64,
        69,
        149
      ]
    },
    {
      "name": "curveCreated",
      "discriminator": [
        207,
        148,
        202,
        45,
        236,
        100,
        171,
        230
      ]
    },
    {
      "name": "curveSell",
      "discriminator": [
        187,
        174,
        54,
        128,
        0,
        58,
        139,
        89
      ]
    },
    {
      "name": "exitCreated",
      "discriminator": [
        164,
        242,
        35,
        252,
        14,
        129,
        5,
        212
      ]
    },
    {
      "name": "exitSettled",
      "discriminator": [
        235,
        189,
        204,
        55,
        86,
        35,
        66,
        151
      ]
    },
    {
      "name": "liquidityAdded",
      "discriminator": [
        154,
        26,
        221,
        108,
        238,
        64,
        217,
        161
      ]
    },
    {
      "name": "liquidityPoolCreated",
      "discriminator": [
        153,
        127,
        139,
        139,
        102,
        77,
        177,
        35
      ]
    },
    {
      "name": "liquidityRemoved",
      "discriminator": [
        225,
        105,
        216,
        39,
        124,
        116,
        169,
        189
      ]
    },
    {
      "name": "proRataClaimed",
      "discriminator": [
        167,
        130,
        127,
        98,
        66,
        75,
        30,
        33
      ]
    },
    {
      "name": "saleCommitted",
      "discriminator": [
        194,
        215,
        178,
        123,
        62,
        61,
        0,
        61
      ]
    },
    {
      "name": "saleCreated",
      "discriminator": [
        164,
        187,
        32,
        35,
        143,
        167,
        235,
        132
      ]
    },
    {
      "name": "saleFinalized",
      "discriminator": [
        40,
        86,
        126,
        227,
        165,
        195,
        95,
        182
      ]
    },
    {
      "name": "swapExecuted",
      "discriminator": [
        150,
        166,
        26,
        225,
        28,
        89,
        38,
        79
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroMaxSupply",
      "msg": "max_supply must be > 0"
    },
    {
      "code": 6001,
      "name": "invalidReserveRatio",
      "msg": "reserve_ratio_ppm must be ≤ 1_000_000 (100%)"
    },
    {
      "code": 6002,
      "name": "invalidCurveType",
      "msg": "curve_type must be 0 (linear) or 1 (exponential)"
    },
    {
      "code": 6003,
      "name": "invalidFeeBps",
      "msg": "fee_bps must be < 10_000"
    },
    {
      "code": 6004,
      "name": "identicalMints",
      "msg": "base_mint and quote_mint must differ"
    },
    {
      "code": 6005,
      "name": "poolMintMismatch",
      "msg": "pool mints or vaults do not match the pool state"
    },
    {
      "code": 6006,
      "name": "invalidSwapDirection",
      "msg": "swap direction must be 0 (base→quote) or 1 (quote→base)"
    },
    {
      "code": 6007,
      "name": "mathOverflow",
      "msg": "math overflow in curve calculation"
    },
    {
      "code": 6008,
      "name": "zeroAmount",
      "msg": "amount must be > 0"
    },
    {
      "code": 6009,
      "name": "exceedsMaxSupply",
      "msg": "buy would exceed curve's max_supply"
    },
    {
      "code": 6010,
      "name": "slippageExceeded",
      "msg": "cost or return missed slippage threshold"
    },
    {
      "code": 6011,
      "name": "exceedsSupply",
      "msg": "token_amount exceeds curve.current_supply"
    },
    {
      "code": 6012,
      "name": "insufficientReserve",
      "msg": "return_amount exceeds curve.reserve_balance"
    },
    {
      "code": 6013,
      "name": "insufficientInitialLiquidity",
      "msg": "initial liquidity is too small"
    },
    {
      "code": 6014,
      "name": "insufficientLiquidity",
      "msg": "pool has insufficient liquidity"
    },
    {
      "code": 6015,
      "name": "invalidOverflowTarget",
      "msg": "overflow_quote must be ≥ target_quote"
    },
    {
      "code": 6016,
      "name": "invalidDuration",
      "msg": "duration_secs must be > 0"
    },
    {
      "code": 6017,
      "name": "saleNotActive",
      "msg": "sale is not Active (already finalized or cancelled)"
    },
    {
      "code": 6018,
      "name": "saleClosed",
      "msg": "sale has closed (now >= end_time)"
    },
    {
      "code": 6019,
      "name": "overflowExceeded",
      "msg": "commitment would exceed sale.overflow_quote"
    },
    {
      "code": 6020,
      "name": "unauthorized",
      "msg": "caller is not the exit creator"
    },
    {
      "code": 6021,
      "name": "alreadySettled",
      "msg": "exit was already settled"
    },
    {
      "code": 6022,
      "name": "notSettled",
      "msg": "exit has not been settled yet"
    },
    {
      "code": 6023,
      "name": "shareTooSmall",
      "msg": "computed share rounded to zero — burn more or wait for settle"
    },
    {
      "code": 6024,
      "name": "cannotFinalizeYet",
      "msg": "cannot finalize sale yet (active period not over and proceeds < target)"
    },
    {
      "code": 6025,
      "name": "saleNotCompleted",
      "msg": "sale is not Completed yet — finalize first"
    },
    {
      "code": 6026,
      "name": "alreadyClaimed",
      "msg": "commitment already claimed"
    },
    {
      "code": 6027,
      "name": "trustNotInCreationMode",
      "msg": "trust must be in creation mode to initialize the unifutures module"
    },
    {
      "code": 6028,
      "name": "assetMintMismatch",
      "msg": "asset_mint does not match the exit's canonical asset mint"
    },
    {
      "code": 6029,
      "name": "quoteMintMismatch",
      "msg": "quote_mint does not match the curve's canonical quote mint"
    },
    {
      "code": 6030,
      "name": "supplySnapshotMismatch",
      "msg": "total_supply_snapshot must equal asset_mint.supply at create time"
    }
  ],
  "types": [
    {
      "name": "allocationClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "allocation",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bondingCurve",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "assetMint",
            "docs": [
              "Canonical asset mint sold by this curve. Buy/sell reject any other",
              "asset mint so callers cannot route a TRUST curve through a worthless",
              "substitute token."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "docs": [
              "Canonical quote mint accepted by this curve, typically USDC."
            ],
            "type": "pubkey"
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
            "name": "currentSupply",
            "type": "u64"
          },
          {
            "name": "reserveBalance",
            "type": "u128"
          },
          {
            "name": "reserveRatioPpm",
            "type": "u32"
          },
          {
            "name": "proceedsCollected",
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
      "name": "commitmentSale",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "creator",
            "type": "pubkey"
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
            "name": "overflowQuote",
            "type": "u64"
          },
          {
            "name": "proceedsCollected",
            "type": "u64"
          },
          {
            "name": "commitmentsCollected",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "endTime",
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
      "name": "curveBuy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "tokenAmount",
            "type": "u64"
          },
          {
            "name": "cost",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "assetMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
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
          }
        ]
      }
    },
    {
      "name": "curveSell",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "tokenAmount",
            "type": "u64"
          },
          {
            "name": "returnAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "exit",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "assetMint",
            "docs": [
              "Canonical asset mint pinned at exit creation. claim_pro_rata MUST",
              "burn this mint — passing a different mint is rejected so an",
              "attacker cannot mint a worthless SPL token and drain the quote",
              "vault by claiming against it."
            ],
            "type": "pubkey"
          },
          {
            "name": "exitQuote",
            "type": "u64"
          },
          {
            "name": "totalSupplySnapshot",
            "docs": [
              "Total asset supply captured at exit creation. Verified to equal",
              "`asset_mint.supply` at create time so the per-token payout",
              "denominator cannot be undersized by the creator to over-pay early",
              "claimers."
            ],
            "type": "u64"
          },
          {
            "name": "proceedsCollected",
            "type": "u64"
          },
          {
            "name": "remainingProceeds",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "endTime",
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
      "name": "exitCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "assetMint",
            "type": "pubkey"
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
            "name": "endTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "exitSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "exitQuote",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "poolId",
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
            "name": "baseUsed",
            "type": "u64"
          },
          {
            "name": "quoteUsed",
            "type": "u64"
          },
          {
            "name": "lpOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityPool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "baseVault",
            "type": "pubkey"
          },
          {
            "name": "quoteVault",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "lpSupply",
            "type": "u64"
          },
          {
            "name": "baseReserve",
            "type": "u64"
          },
          {
            "name": "quoteReserve",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "liquidityPoolCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "liquidityRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "poolId",
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
            "name": "lpBurned",
            "type": "u64"
          },
          {
            "name": "baseOut",
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
      "name": "proRataClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "burned",
            "type": "u64"
          },
          {
            "name": "share",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "saleCommitment",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
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
      "name": "saleCommitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalCommitment",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "saleCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "creator",
            "type": "pubkey"
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
            "name": "overflowQuote",
            "type": "u64"
          },
          {
            "name": "endTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "saleFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
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
            "name": "proceedsCollected",
            "type": "u64"
          },
          {
            "name": "commitmentsCollected",
            "type": "u64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "swapExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "direction",
            "type": "u8"
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          },
          {
            "name": "feeAmount",
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
      "name": "unifuturesModuleState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trust",
            "type": "pubkey"
          },
          {
            "name": "curveCount",
            "type": "u64"
          },
          {
            "name": "saleCount",
            "type": "u64"
          },
          {
            "name": "exitCount",
            "type": "u64"
          },
          {
            "name": "poolCount",
            "type": "u64"
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
