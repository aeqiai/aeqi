//! Liquidity-pool math for the internal Unifutures DEX primitive.
//!
//! The program keeps the on-chain state and token movement in `lib.rs`.
//! This module stays pure: it quotes LP minting, withdrawals, and
//! constant-product swap outcomes with fee/slippage semantics.

pub const FEE_BPS_DENOMINATOR: u128 = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LiquidityQuote {
    pub lp_out: u64,
    pub base_used: u64,
    pub quote_used: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SwapQuote {
    pub amount_out: u64,
    pub fee_amount: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SwapDirection {
    BaseToQuote = 0,
    QuoteToBase = 1,
}

impl SwapDirection {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(SwapDirection::BaseToQuote),
            1 => Some(SwapDirection::QuoteToBase),
            _ => None,
        }
    }
}

pub fn integer_sqrt(value: u128) -> Option<u128> {
    if value == 0 {
        return Some(0);
    }
    let mut x0 = value;
    let mut x1 = (x0 + 1) / 2;
    while x1 < x0 {
        x0 = x1;
        x1 = (x0 + value / x0) / 2;
    }
    Some(x0)
}

pub fn quote_initial_liquidity(base_amount: u64, quote_amount: u64) -> Option<LiquidityQuote> {
    if base_amount == 0 || quote_amount == 0 {
        return None;
    }
    let product = (base_amount as u128).checked_mul(quote_amount as u128)?;
    let lp_out_u128 = integer_sqrt(product)?;
    let lp_out: u64 = lp_out_u128.try_into().ok()?;
    Some(LiquidityQuote {
        lp_out,
        base_used: base_amount,
        quote_used: quote_amount,
    })
}

pub fn quote_add_liquidity(
    base_amount: u64,
    quote_amount: u64,
    base_reserve: u64,
    quote_reserve: u64,
    lp_supply: u64,
) -> Option<LiquidityQuote> {
    if base_amount == 0 || quote_amount == 0 {
        return None;
    }

    if lp_supply == 0 || base_reserve == 0 || quote_reserve == 0 {
        return quote_initial_liquidity(base_amount, quote_amount);
    }

    let lp_from_base = (base_amount as u128)
        .checked_mul(lp_supply as u128)?
        .checked_div(base_reserve as u128)?;
    let lp_from_quote = (quote_amount as u128)
        .checked_mul(lp_supply as u128)?
        .checked_div(quote_reserve as u128)?;

    let lp_out_u128 = lp_from_base.min(lp_from_quote);
    if lp_out_u128 == 0 {
        return None;
    }

    let lp_out: u64 = lp_out_u128.try_into().ok()?;
    let base_used_u128 = lp_out_u128
        .checked_mul(base_reserve as u128)?
        .checked_div(lp_supply as u128)?;
    let quote_used_u128 = lp_out_u128
        .checked_mul(quote_reserve as u128)?
        .checked_div(lp_supply as u128)?;

    let base_used: u64 = base_used_u128.try_into().ok()?;
    let quote_used: u64 = quote_used_u128.try_into().ok()?;
    if base_used == 0 || quote_used == 0 {
        return None;
    }

    Some(LiquidityQuote {
        lp_out,
        base_used,
        quote_used,
    })
}

pub fn quote_remove_liquidity(
    lp_amount: u64,
    base_reserve: u64,
    quote_reserve: u64,
    lp_supply: u64,
) -> Option<(u64, u64)> {
    if lp_amount == 0 || lp_supply == 0 || lp_amount > lp_supply {
        return None;
    }
    let base_out = (lp_amount as u128)
        .checked_mul(base_reserve as u128)?
        .checked_div(lp_supply as u128)?;
    let quote_out = (lp_amount as u128)
        .checked_mul(quote_reserve as u128)?
        .checked_div(lp_supply as u128)?;
    Some((base_out.try_into().ok()?, quote_out.try_into().ok()?))
}

pub fn quote_swap_exact_in(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    fee_bps: u16,
) -> Option<SwapQuote> {
    if reserve_in == 0 || reserve_out == 0 || amount_in == 0 {
        return None;
    }
    if fee_bps as u128 >= FEE_BPS_DENOMINATOR {
        return None;
    }

    let fee_amount_u128 = (amount_in as u128)
        .checked_mul(fee_bps as u128)?
        .checked_div(FEE_BPS_DENOMINATOR)?;
    let effective_in = (amount_in as u128).checked_sub(fee_amount_u128)?;
    if effective_in == 0 {
        return None;
    }

    let amount_out_u128 = (reserve_out as u128)
        .checked_mul(effective_in)?
        .checked_div((reserve_in as u128).checked_add(effective_in)?)?;

    let amount_out: u64 = amount_out_u128.try_into().ok()?;
    let fee_amount: u64 = fee_amount_u128.try_into().ok()?;
    if amount_out == 0 {
        return None;
    }

    Some(SwapQuote {
        amount_out,
        fee_amount,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqrt_handles_small_values() {
        assert_eq!(integer_sqrt(0), Some(0));
        assert_eq!(integer_sqrt(1), Some(1));
        assert_eq!(integer_sqrt(15), Some(3));
        assert_eq!(integer_sqrt(16), Some(4));
    }

    #[test]
    fn initial_liquidity_uses_geometric_mean() {
        let q = quote_initial_liquidity(1_000, 4_000).unwrap();
        assert_eq!(q.base_used, 1_000);
        assert_eq!(q.quote_used, 4_000);
        assert_eq!(q.lp_out, 2_000);
    }

    #[test]
    fn add_liquidity_quotes_proportional_deposit() {
        let q = quote_add_liquidity(500, 1_000, 1_000, 2_000, 1_000).unwrap();
        assert_eq!(q.lp_out, 500);
        assert_eq!(q.base_used, 500);
        assert_eq!(q.quote_used, 1_000);
    }

    #[test]
    fn remove_liquidity_quotes_pro_rata_with_rounding_down() {
        let (base_out, quote_out) = quote_remove_liquidity(250, 1_000, 2_000, 1_000).unwrap();
        assert_eq!(base_out, 250);
        assert_eq!(quote_out, 500);
    }

    #[test]
    fn swap_exact_in_applies_fee_before_price_impact() {
        let q = quote_swap_exact_in(1_000, 1_000, 1_000, 30).unwrap();
        assert!(q.amount_out > 0);
        assert_eq!(q.fee_amount, 3);
    }
}
