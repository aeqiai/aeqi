//! SQLite schema and helpers for the paymaster gas-budget ledger.
//!
//! Schema: `gas_budgets(entity_id TEXT PRIMARY KEY, month TEXT, budget_remaining_wei TEXT, last_updated TEXT)`
//!
//! All monetary values are stored as decimal strings (wei) to avoid integer
//! overflow for large U256 amounts without pulling in a BigDecimal dependency.
//! The `budget_remaining_wei` column is updated by the sponsorship policy on
//! every approved UserOp.

use anyhow::Result;
use rusqlite::Connection;
use tracing::info;

/// Default gas budget per entity per month (0.1 ETH in wei).
/// This stub value is replaced by real policy integration in Phase-2.
pub const DEFAULT_MONTHLY_BUDGET_WEI: u128 = 100_000_000_000_000_000; // 0.1 ETH

/// Path to the paymaster SQLite database.
pub const DB_PATH: &str = "/var/lib/aeqi/paymaster.db";

/// Initialise the database schema idempotently.
///
/// Safe to call on every service startup — `CREATE TABLE IF NOT EXISTS` ensures
/// no data is lost on a repeated start.
pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS gas_budgets (
            entity_id           TEXT NOT NULL PRIMARY KEY,
            month               TEXT NOT NULL,
            budget_remaining_wei TEXT NOT NULL,
            last_updated        TEXT NOT NULL
        );
        ",
    )?;
    info!("paymaster DB schema ready");
    Ok(())
}

/// Return the current budget remaining (in wei) for `entity_id` in `month`.
///
/// If no row exists for this entity+month, inserts a fresh row with the
/// default budget and returns that value.
pub fn get_or_init_budget(conn: &Connection, entity_id: &str, month: &str) -> Result<u128> {
    // Attempt to read existing row for this month.
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT budget_remaining_wei FROM gas_budgets WHERE entity_id = ?1 AND month = ?2",
        rusqlite::params![entity_id, month],
        |row| row.get(0),
    );

    match result {
        Ok(val) => {
            let wei: u128 = val.parse().unwrap_or(DEFAULT_MONTHLY_BUDGET_WEI);
            Ok(wei)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // First request this month — initialise.
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO gas_budgets (entity_id, month, budget_remaining_wei, last_updated)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(entity_id) DO UPDATE SET
                   month               = excluded.month,
                   budget_remaining_wei = excluded.budget_remaining_wei,
                   last_updated        = excluded.last_updated",
                rusqlite::params![
                    entity_id,
                    month,
                    DEFAULT_MONTHLY_BUDGET_WEI.to_string(),
                    now,
                ],
            )?;
            Ok(DEFAULT_MONTHLY_BUDGET_WEI)
        }
        Err(e) => Err(e.into()),
    }
}

/// Deduct `cost_wei` from the budget for `entity_id` in `month`.
///
/// Caller must verify budget > cost_wei before calling this; this function
/// performs the deduction unconditionally.
pub fn deduct_budget(
    conn: &Connection,
    entity_id: &str,
    month: &str,
    cost_wei: u128,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE gas_budgets
         SET budget_remaining_wei = CAST(CAST(budget_remaining_wei AS INTEGER) - ?1 AS TEXT),
             last_updated = ?2
         WHERE entity_id = ?3 AND month = ?4",
        rusqlite::params![cost_wei as i64, now, entity_id, month],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_get_or_init_creates_fresh_row() {
        let conn = in_memory();
        let budget = get_or_init_budget(&conn, "entity-1", "2026-05").unwrap();
        assert_eq!(budget, DEFAULT_MONTHLY_BUDGET_WEI);
    }

    #[test]
    fn test_deduct_budget() {
        let conn = in_memory();
        get_or_init_budget(&conn, "entity-2", "2026-05").unwrap();
        deduct_budget(&conn, "entity-2", "2026-05", 1_000_000).unwrap();
        let remaining = get_or_init_budget(&conn, "entity-2", "2026-05").unwrap();
        assert_eq!(remaining, DEFAULT_MONTHLY_BUDGET_WEI - 1_000_000);
    }
}
