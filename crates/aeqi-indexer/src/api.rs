//! HTTP + GraphQL API. Mirrors the subgraph's query surface for indexed data.

use anyhow::Result;
use async_graphql::{
    Context, EmptyMutation, EmptySubscription, Object, Schema, SimpleObject, http::GraphiQLSource,
};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    Extension, Router,
    response::{Html, IntoResponse},
    routing::get,
};
use rusqlite::Connection;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::store;

/// Shared state for the GraphQL resolver layer.
/// Wraps the SQLite connection in a Mutex (rusqlite is not Send+Sync, but we're
/// fine with serialized access for MVP — single-writer indexer pattern).
pub type SharedDb = Arc<Mutex<Connection>>;

/// Top-level GraphQL Query type.
pub struct Query;

/// GraphQL projection of a Factory's current config snapshot.
#[derive(SimpleObject, Clone)]
pub struct FactoryConfig {
    pub factory_address: String,
    pub beacon_address: Option<String>,
    pub partner_ipfs_cid: Option<String>,
    pub last_updated_block: u64,
    pub last_updated_tx: String,
}

impl From<store::FactoryConfigRow> for FactoryConfig {
    fn from(r: store::FactoryConfigRow) -> Self {
        FactoryConfig {
            factory_address: r.factory_address,
            beacon_address: r.beacon_address,
            partner_ipfs_cid: r.partner_ipfs_cid,
            last_updated_block: r.last_updated_block,
            last_updated_tx: r.last_updated_tx,
        }
    }
}

/// GraphQL projection of a Factory admin grant/revocation audit row.
#[derive(SimpleObject, Clone)]
pub struct FactoryAdminEvent {
    pub factory_address: String,
    pub admin_address: String,
    /// 'added' | 'removed'
    pub kind: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::FactoryAdminEventRow> for FactoryAdminEvent {
    fn from(r: store::FactoryAdminEventRow) -> Self {
        FactoryAdminEvent {
            factory_address: r.factory_address,
            admin_address: r.admin_address,
            kind: r.kind,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a Factory-registered template.
#[derive(SimpleObject, Clone)]
pub struct Template {
    pub factory_address: String,
    pub template_id: String,
    pub replace_count: u64,
    pub first_seen_block: u64,
    pub last_replaced_block: u64,
    pub last_replaced_tx: String,
}

impl From<store::TemplateRow> for Template {
    fn from(r: store::TemplateRow) -> Self {
        Template {
            factory_address: r.factory_address,
            template_id: r.template_id,
            replace_count: r.replace_count,
            first_seen_block: r.first_seen_block,
            last_replaced_block: r.last_replaced_block,
            last_replaced_tx: r.last_replaced_tx,
        }
    }
}

/// GraphQL projection of a Fund NAV checkpoint.
#[derive(SimpleObject, Clone)]
pub struct FundNav {
    pub module_address: String,
    pub checkpoint_id: u64,
    pub net_nav: String,
    pub token_quote: String,
    pub mgmt_fees_charged: String,
    pub carry_charged: String,
    pub block_number: u64,
    pub tx_hash: String,
}

impl From<store::FundNavRow> for FundNav {
    fn from(r: store::FundNavRow) -> Self {
        FundNav {
            module_address: r.module_address,
            checkpoint_id: r.checkpoint_id,
            net_nav: r.net_nav,
            token_quote: r.token_quote,
            mgmt_fees_charged: r.mgmt_fees_charged,
            carry_charged: r.carry_charged,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
        }
    }
}

/// GraphQL projection of a Fund flow (deposit/redemption/carry request).
#[derive(SimpleObject, Clone)]
pub struct FundFlow {
    pub module_address: String,
    pub request_id: String,
    pub role_id: String,
    /// 0 = deposit, 1 = redemption, 2 = carry (consumer interprets)
    pub flow_type: u32,
    pub amount_in: String,
    pub amount_out: Option<String>,
    /// 'requested' | 'claimed' | 'cancelled'
    pub status: String,
    pub requested_block: u64,
    pub requested_tx: String,
    pub settled_block: Option<u64>,
    pub settled_tx: Option<String>,
}

impl From<store::FundFlowRow> for FundFlow {
    fn from(r: store::FundFlowRow) -> Self {
        FundFlow {
            module_address: r.module_address,
            request_id: r.request_id,
            role_id: r.role_id,
            flow_type: r.flow_type as u32,
            amount_in: r.amount_in,
            amount_out: r.amount_out,
            status: r.status,
            requested_block: r.requested_block,
            requested_tx: r.requested_tx,
            settled_block: r.settled_block,
            settled_tx: r.settled_tx,
        }
    }
}

/// GraphQL projection of a Fund investment position.
#[derive(SimpleObject, Clone)]
pub struct FundPosition {
    pub module_address: String,
    pub position_id: String,
    pub position_manager_id: String,
    /// 'open' | 'closed'
    pub status: String,
    pub quote_asset_received: Option<String>,
    pub opened_block: u64,
    pub opened_tx: String,
    pub closed_block: Option<u64>,
    pub closed_tx: Option<String>,
}

impl From<store::FundPositionRow> for FundPosition {
    fn from(r: store::FundPositionRow) -> Self {
        FundPosition {
            module_address: r.module_address,
            position_id: r.position_id,
            position_manager_id: r.position_manager_id,
            status: r.status,
            quote_asset_received: r.quote_asset_received,
            opened_block: r.opened_block,
            opened_tx: r.opened_tx,
            closed_block: r.closed_block,
            closed_tx: r.closed_tx,
        }
    }
}

/// GraphQL projection of a Fund position interaction audit row.
#[derive(SimpleObject, Clone)]
pub struct FundPositionInteraction {
    pub module_address: String,
    pub position_id: String,
    pub role_id: String,
    pub action: u32,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::FundPositionInteractionRow> for FundPositionInteraction {
    fn from(r: store::FundPositionInteractionRow) -> Self {
        FundPositionInteraction {
            module_address: r.module_address,
            position_id: r.position_id,
            role_id: r.role_id,
            action: r.action as u32,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a budget on a Budget module.
#[derive(SimpleObject, Clone)]
pub struct Budget {
    pub module_address: String,
    pub budget_id: String,
    /// 'created' | 'frozen' | 'active' (after unfreeze) | 'removed'
    pub status: String,
    pub created_block: u64,
    pub created_tx: String,
}

impl From<store::BudgetRow> for Budget {
    fn from(r: store::BudgetRow) -> Self {
        Budget {
            module_address: r.module_address,
            budget_id: r.budget_id,
            status: r.status,
            created_block: r.created_block,
            created_tx: r.created_tx,
        }
    }
}

/// GraphQL projection of a budget money-movement audit row.
#[derive(SimpleObject, Clone)]
pub struct BudgetMovement {
    pub module_address: String,
    pub budget_id: String,
    /// 'deposit' | 'consume'
    pub kind: String,
    pub counterparty_address: String,
    pub asset_address: String,
    /// uint256 hex
    pub amount: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::BudgetMovementRow> for BudgetMovement {
    fn from(r: store::BudgetMovementRow) -> Self {
        BudgetMovement {
            module_address: r.module_address,
            budget_id: r.budget_id,
            kind: r.kind,
            counterparty_address: r.counterparty_address,
            asset_address: r.asset_address,
            amount: r.amount,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a fundraising round on a Funding module.
#[derive(SimpleObject, Clone)]
pub struct Funding {
    pub module_address: String,
    pub funding_id: String,
    /// 'created' | 'active' | 'finalized' | 'removed'
    pub status: String,
    pub created_block: u64,
    pub created_tx: String,
}

impl From<store::FundingRow> for Funding {
    fn from(r: store::FundingRow) -> Self {
        Funding {
            module_address: r.module_address,
            funding_id: r.funding_id,
            status: r.status,
            created_block: r.created_block,
            created_tx: r.created_tx,
        }
    }
}

/// GraphQL projection of a Funding_ExitExecuted audit row.
#[derive(SimpleObject, Clone)]
pub struct FundingExit {
    pub module_address: String,
    pub exit_id: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::FundingExitRow> for FundingExit {
    fn from(r: store::FundingExitRow) -> Self {
        FundingExit {
            module_address: r.module_address,
            exit_id: r.exit_id,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a vesting position.
#[derive(SimpleObject, Clone)]
pub struct VestingPosition {
    pub module_address: String,
    pub position_id: String,
    /// 'created' | 'active' | 'removed'
    pub status: String,
    pub created_block: u64,
    pub created_tx: String,
}

impl From<store::VestingPositionRow> for VestingPosition {
    fn from(r: store::VestingPositionRow) -> Self {
        VestingPosition {
            module_address: r.module_address,
            position_id: r.position_id,
            status: r.status,
            created_block: r.created_block,
            created_tx: r.created_tx,
        }
    }
}

/// GraphQL projection of a vesting contribution audit row.
#[derive(SimpleObject, Clone)]
pub struct VestingContribution {
    pub module_address: String,
    pub position_id: String,
    pub from_address: String,
    /// uint256 hex
    pub amount: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::VestingContributionRow> for VestingContribution {
    fn from(r: store::VestingContributionRow) -> Self {
        VestingContribution {
            module_address: r.module_address,
            position_id: r.position_id,
            from_address: r.from_address,
            amount: r.amount,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a vesting claim audit row.
#[derive(SimpleObject, Clone)]
pub struct VestingClaim {
    pub module_address: String,
    pub position_id: String,
    pub asset_address: String,
    pub to_address: String,
    /// uint256 hex
    pub amount: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::VestingClaimRow> for VestingClaim {
    fn from(r: store::VestingClaimRow) -> Self {
        VestingClaim {
            module_address: r.module_address,
            position_id: r.position_id,
            asset_address: r.asset_address,
            to_address: r.to_address,
            amount: r.amount,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a token holder's balance.
#[derive(SimpleObject, Clone)]
pub struct TokenBalance {
    pub token_address: String,
    pub holder_address: String,
    /// uint256 hex
    pub balance: String,
    pub last_updated_block: u64,
}

impl From<store::TokenBalanceRow> for TokenBalance {
    fn from(r: store::TokenBalanceRow) -> Self {
        TokenBalance {
            token_address: r.token_address,
            holder_address: r.holder_address,
            balance: r.balance,
            last_updated_block: r.last_updated_block,
        }
    }
}

/// GraphQL projection of a Token Transfer audit-log row.
#[derive(SimpleObject, Clone)]
pub struct TokenTransfer {
    pub token_address: String,
    pub from_address: String,
    pub to_address: String,
    /// uint256 hex
    pub value: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::TokenTransferRow> for TokenTransfer {
    fn from(r: store::TokenTransferRow) -> Self {
        TokenTransfer {
            token_address: r.token_address,
            from_address: r.from_address,
            to_address: r.to_address,
            value: r.value,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a governance proposal.
#[derive(SimpleObject, Clone)]
pub struct Proposal {
    pub module_address: String,
    pub proposal_id: String,
    pub governance_config_id: String,
    pub proposer_address: String,
    pub vote_start: u64,
    pub vote_end: u64,
    pub ipfs_cid: String,
    /// 'created' | 'succeeded' | 'canceled' | 'executed'
    pub status: String,
    pub created_block: u64,
    pub created_tx: String,
    /// Sum of token-weighted For votes (support=1). u256 hex string. "0x0" when no votes yet.
    pub for_votes: String,
    /// Sum of token-weighted Against votes (support=0). u256 hex string. "0x0" when no votes yet.
    pub against_votes: String,
}

impl From<store::ProposalRow> for Proposal {
    fn from(r: store::ProposalRow) -> Self {
        Proposal {
            module_address: r.module_address,
            proposal_id: r.proposal_id,
            governance_config_id: r.governance_config_id,
            proposer_address: r.proposer_address,
            vote_start: r.vote_start,
            vote_end: r.vote_end,
            ipfs_cid: r.ipfs_cid,
            status: r.status,
            created_block: r.created_block,
            created_tx: r.created_tx,
            for_votes: r.for_votes,
            against_votes: r.against_votes,
        }
    }
}

/// GraphQL projection of a vote cast on a proposal.
#[derive(SimpleObject, Clone)]
pub struct Vote {
    pub module_address: String,
    pub proposal_id: String,
    pub voter_address: String,
    /// 0=Against, 1=For, 2=Abstain (OpenZeppelin Bravo convention)
    pub support: u32,
    /// uint256 hex
    pub weight: String,
    pub reason: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::VoteRow> for Vote {
    fn from(r: store::VoteRow) -> Self {
        Vote {
            module_address: r.module_address,
            proposal_id: r.proposal_id,
            voter_address: r.voter_address,
            support: r.support as u32,
            weight: r.weight,
            reason: r.reason,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a Role module's role definition.
#[derive(SimpleObject, Clone)]
pub struct Role {
    pub module_address: String,
    pub role_id: String,
    pub creator_address: String,
    pub created_block: u64,
    pub created_tx: String,
}

impl From<store::RoleRow> for Role {
    fn from(r: store::RoleRow) -> Self {
        Role {
            module_address: r.module_address,
            role_id: r.role_id,
            creator_address: r.creator_address,
            created_block: r.created_block,
            created_tx: r.created_tx,
        }
    }
}

/// Treasury token balance for a TRUST contract. `token_address` is the
/// ERC20/Token-module contract; `balance` is a uint256 hex string.
#[derive(SimpleObject, Clone)]
pub struct TreasuryBalance {
    pub token_address: String,
    pub balance: String,
    pub last_updated_block: u64,
}

/// A Transfer event that touched the TRUST treasury (sent or received).
#[derive(SimpleObject, Clone)]
pub struct TreasuryTransfer {
    pub token_address: String,
    pub from_address: String,
    pub to_address: String,
    /// uint256 hex
    pub value: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// Voting power for an account on a governance module. `voting_power` is the
/// raw token balance (u256 hex) in the Token module that backs the governance.
#[derive(SimpleObject, Clone)]
pub struct VotingPower {
    pub module_address: String,
    pub account_address: String,
    /// Raw token balance as u256 hex (18 decimals).
    pub voting_power: String,
}

/// GraphQL projection of a role assignment audit row.
#[derive(SimpleObject, Clone)]
pub struct RoleAssignment {
    pub module_address: String,
    pub role_id: String,
    pub account_address: String,
    /// 'assigned' | 'resigned' | 'removed' | 'transferred_from' | 'transferred_to'
    pub kind: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::RoleAssignmentRow> for RoleAssignment {
    fn from(r: store::RoleAssignmentRow) -> Self {
        RoleAssignment {
            module_address: r.module_address,
            role_id: r.role_id,
            account_address: r.account_address,
            kind: r.kind,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// Cap-table view of a single filled role on a TRUST.
/// Matches the shape the UI Ownership tab queries:
/// `{ account roleTypeId slotIndex ipfsCid }`.
///
/// `role_type_id` is the on-chain `roleId` (bytes32 hex). `slot_index` is
/// always 0 — the on-chain events don't emit it; the field is included for
/// UI compatibility. `ipfs_cid` is populated when the indexer has seen
/// `Role_RoleAssignmentStatusUpdated`; null otherwise.
#[derive(SimpleObject, Clone)]
pub struct TrustRoleAssignment {
    /// Address currently holding this role.
    pub account: String,
    /// The role's bytes32 identifier — used as roleTypeId by the UI.
    pub role_type_id: String,
    /// Always 0 — on-chain events don't carry slot index.
    pub slot_index: i32,
    /// IPFS CID of the role metadata (null if not yet indexed).
    pub ipfs_cid: Option<String>,
    /// Block where the current assignment was made.
    pub assigned_block: u64,
    /// Tx hash of the current assignment.
    pub assigned_tx: String,
}

impl From<store::TrustRoleAssignmentRow> for TrustRoleAssignment {
    fn from(r: store::TrustRoleAssignmentRow) -> Self {
        TrustRoleAssignment {
            account: r.account_address,
            role_type_id: r.role_id,
            slot_index: 0,
            ipfs_cid: r.ipfs_cid,
            assigned_block: r.assigned_block,
            assigned_tx: r.assigned_tx,
        }
    }
}

/// GraphQL projection of a permissions audit-log row.
#[derive(SimpleObject, Clone)]
pub struct PermissionsEvent {
    pub trust_address: String,
    pub entity_id: String,
    /// 'granted' | 'revoked' | 'set'
    pub kind: String,
    /// uint256 hex
    pub flags: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

impl From<store::PermissionsEventRow> for PermissionsEvent {
    fn from(r: store::PermissionsEventRow) -> Self {
        PermissionsEvent {
            trust_address: r.trust_address,
            entity_id: r.entity_id,
            kind: r.kind,
            flags: r.flags,
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            log_index: r.log_index,
        }
    }
}

/// GraphQL projection of a module attached to a TRUST.
#[derive(SimpleObject, Clone)]
pub struct Module {
    pub trust_address: String,
    pub module_id: String,
    pub module_address: String,
    pub module_acl: String,
    pub attached_block: u64,
    pub attached_tx: String,
}

impl From<store::ModuleRow> for Module {
    fn from(r: store::ModuleRow) -> Self {
        Module {
            trust_address: r.trust_address,
            module_id: r.module_id,
            module_address: r.module_address,
            module_acl: r.module_acl,
            attached_block: r.attached_block,
            attached_tx: r.attached_tx,
        }
    }
}

/// GraphQL projection of a signer authorization row.
/// trust_address is Option because schema v2 allows signer rows to land
/// before the corresponding TrustCreated event (multi-sig registration flow).
#[derive(SimpleObject, Clone)]
pub struct Signer {
    pub trust_id: String,
    pub trust_address: Option<String>,
    pub signer_address: String,
    pub address_key: String,
    pub has_signed: bool,
    pub added_block: u64,
    pub added_tx: String,
}

impl From<store::SignerRow> for Signer {
    fn from(r: store::SignerRow) -> Self {
        Signer {
            trust_id: r.trust_id,
            trust_address: r.trust_address,
            signer_address: r.signer_address,
            address_key: r.address_key,
            has_signed: r.has_signed,
            added_block: r.added_block,
            added_tx: r.added_tx,
        }
    }
}

/// GraphQL projection of a TRUST contract row.
/// Schema v2: address/creator/created_block/created_tx are nullable
/// because Registered may land before Created in multi-sig flows.
#[derive(SimpleObject, Clone)]
pub struct Trust {
    /// On-chain trust ID (bytes32 as hex). The stable identity.
    pub trust_id: String,
    /// Contract address (hex string). NULL until Created lands.
    pub address: Option<String>,
    /// Address that called Factory to create this TRUST. NULL until Created lands.
    pub creator_address: Option<String>,
    /// Template the TRUST was registered with.
    pub template_id: Option<String>,
    /// IPFS CID of off-chain metadata.
    pub ipfs_cid: Option<String>,
    /// Number of authorized signers at registration time.
    pub signers_count: Option<i64>,
    /// Number of value-config slots at registration time.
    pub value_configs_count: Option<i64>,
    /// Block number where the TRUST was created.
    pub created_block: Option<u64>,
    /// Transaction hash that created the TRUST.
    pub created_tx: Option<String>,
}

impl From<store::TrustRow> for Trust {
    fn from(r: store::TrustRow) -> Self {
        Trust {
            trust_id: r.trust_id,
            address: r.address,
            creator_address: r.creator_address,
            template_id: r.template_id,
            ipfs_cid: r.ipfs_cid,
            signers_count: r.signers_count,
            value_configs_count: r.value_configs_count,
            created_block: r.created_block,
            created_tx: r.created_tx,
        }
    }
}

#[Object]
impl Query {
    /// Look up a single TRUST by its on-chain address. Returns None if the
    /// TRUST hasn't been Created yet (multi-sig: Registered without Created).
    async fn trust(
        &self,
        ctx: &Context<'_>,
        address: String,
    ) -> async_graphql::Result<Option<Trust>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let row = store::get_trust(&conn, &address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(row.map(Into::into))
    }

    /// Look up a single TRUST by its trust_id. Useful for multi-sig pre-create
    /// state where the address is not yet known.
    async fn trust_by_id(
        &self,
        ctx: &Context<'_>,
        trust_id: String,
    ) -> async_graphql::Result<Option<Trust>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let row = store::get_trust_by_id(&conn, &trust_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(row.map(Into::into))
    }

    /// Indexer health probe + version.
    async fn version(&self) -> &'static str {
        crate::VERSION
    }

    /// Total number of TRUSTs the indexer has seen.
    async fn trusts_count(&self, ctx: &Context<'_>) -> async_graphql::Result<i64> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM trusts", [], |r| r.get(0))
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(n)
    }

    /// All signers authorized on a TRUST, ordered by the block they were added.
    async fn trust_signers(
        &self,
        ctx: &Context<'_>,
        trust_address: String,
    ) -> async_graphql::Result<Vec<Signer>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_trust_signers(&conn, &trust_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All modules attached to a TRUST, ordered by attachment block.
    async fn trust_modules(
        &self,
        ctx: &Context<'_>,
        trust_address: String,
    ) -> async_graphql::Result<Vec<Module>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_modules_for_trust(&conn, &trust_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Current config snapshot for a Factory: beacon address + partner IPFS CID.
    /// Returns None if neither has ever been set.
    async fn factory_config(
        &self,
        ctx: &Context<'_>,
        factory_address: String,
    ) -> async_graphql::Result<Option<FactoryConfig>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let row = store::get_factory_config(&conn, &factory_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(row.map(Into::into))
    }

    /// Audit log of admin grants/revocations on a Factory, oldest first.
    /// Frontend computes the current admin set by replaying.
    async fn factory_admin_events(
        &self,
        ctx: &Context<'_>,
        factory_address: String,
    ) -> async_graphql::Result<Vec<FactoryAdminEvent>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_factory_admin_events(&conn, &factory_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All templates registered on a Factory.
    async fn templates_for_factory(
        &self,
        ctx: &Context<'_>,
        factory_address: String,
    ) -> async_graphql::Result<Vec<Template>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_templates_for_factory(&conn, &factory_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All NAV checkpoints for a Fund module, oldest first (chart-friendly).
    async fn fund_navs(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<FundNav>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_fund_navs(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All flows for a Fund module, newest-requested first.
    async fn fund_flows(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<FundFlow>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_fund_flows(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All positions on a Fund module, oldest first.
    async fn fund_positions(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<FundPosition>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_fund_positions(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of interactions on a Fund position, oldest first.
    async fn fund_position_interactions(
        &self,
        ctx: &Context<'_>,
        module_address: String,
        position_id: String,
    ) -> async_graphql::Result<Vec<FundPositionInteraction>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_fund_position_interactions(&conn, &module_address, &position_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All budgets on a Budget module, oldest first.
    async fn budgets_for_module(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<Budget>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_budgets_for_module(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of all movements (deposits + consumes) for a budget.
    async fn budget_movements(
        &self,
        ctx: &Context<'_>,
        module_address: String,
        budget_id: String,
    ) -> async_graphql::Result<Vec<BudgetMovement>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_budget_movements(&conn, &module_address, &budget_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All fundraising rounds on a Funding module, oldest first.
    async fn fundings_for_module(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<Funding>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_fundings_for_module(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of all funding exits on a Funding module, oldest first.
    async fn funding_exits(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<FundingExit>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_funding_exits(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All vesting positions on a Vesting module, oldest first.
    async fn vesting_positions(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<VestingPosition>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_vesting_positions(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of contributions to a vesting position, oldest first.
    async fn vesting_contributions(
        &self,
        ctx: &Context<'_>,
        module_address: String,
        position_id: String,
    ) -> async_graphql::Result<Vec<VestingContribution>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_vesting_contributions(&conn, &module_address, &position_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of claims from a vesting position, oldest first.
    async fn vesting_claims(
        &self,
        ctx: &Context<'_>,
        module_address: String,
        position_id: String,
    ) -> async_graphql::Result<Vec<VestingClaim>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_vesting_claims(&conn, &module_address, &position_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Cap-table view: all holders of a token, largest balance first.
    /// Excludes the zero address (mint/burn pseudo-account) and zero-balance rows.
    async fn token_holders(
        &self,
        ctx: &Context<'_>,
        token_address: String,
    ) -> async_graphql::Result<Vec<TokenBalance>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_token_holders(&conn, &token_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of all Transfer events for a token, oldest first.
    async fn token_transfers(
        &self,
        ctx: &Context<'_>,
        token_address: String,
    ) -> async_graphql::Result<Vec<TokenTransfer>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_token_transfers(&conn, &token_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All proposals on a Governance module, newest first.
    async fn proposals_for_module(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<Proposal>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_proposals_for_module(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All votes cast on a proposal, oldest first.
    async fn votes_for_proposal(
        &self,
        ctx: &Context<'_>,
        module_address: String,
        proposal_id: String,
    ) -> async_graphql::Result<Vec<Vote>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_votes_for_proposal(&conn, &module_address, &proposal_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// All roles defined on a Role module, oldest first.
    async fn roles_for_module(
        &self,
        ctx: &Context<'_>,
        module_address: String,
    ) -> async_graphql::Result<Vec<Role>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_roles_for_module(&conn, &module_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of role assignments for a (module, role), oldest first.
    /// Frontend computes the current occupant by replaying.
    async fn role_assignments(
        &self,
        ctx: &Context<'_>,
        module_address: String,
        role_id: String,
    ) -> async_graphql::Result<Vec<RoleAssignment>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_role_assignments(&conn, &module_address, &role_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Audit log of permissions events for an entity within a TRUST.
    /// Oldest first. Frontend computes effective flags by replaying.
    async fn permissions_events(
        &self,
        ctx: &Context<'_>,
        trust_address: String,
        entity_id: String,
    ) -> async_graphql::Result<Vec<PermissionsEvent>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_permissions_events(&conn, &trust_address, &entity_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Cap-table view: all currently-filled roles across every Role module
    /// attached to a TRUST, identified by its on-chain trust_id (bytes32 hex).
    /// Returns `{ account, roleTypeId, slotIndex, ipfsCid, assignedBlock, assignedTx }`.
    /// Returns an empty list if the trust has no role modules or no filled roles.
    async fn roles_for_trust(
        &self,
        ctx: &Context<'_>,
        trust_id: String,
    ) -> async_graphql::Result<Vec<TrustRoleAssignment>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_trust_role_assignments(&conn, &trust_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Token balances held by the TRUST contract (treasury view). All non-zero
    /// balances, newest-updated first. `trust_id` is the bytes32 on-chain ID.
    async fn treasury_balances(
        &self,
        ctx: &Context<'_>,
        trust_id: String,
    ) -> async_graphql::Result<Vec<TreasuryBalance>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_treasury_balances(&conn, &trust_id)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        let out = rows
            .into_iter()
            .map(|r| TreasuryBalance {
                token_address: r.token_address,
                balance: r.balance,
                last_updated_block: r.last_updated_block,
            })
            .collect();
        Ok(out)
    }

    /// Token Transfer events that touched the TRUST address (inbound or
    /// outbound), newest first. `limit` defaults to 50; max 200.
    async fn treasury_transfers(
        &self,
        ctx: &Context<'_>,
        trust_id: String,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<TreasuryTransfer>> {
        let cap = limit.unwrap_or(50).clamp(1, 200) as u32;
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_treasury_transfers(&conn, &trust_id, cap)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        let out = rows
            .into_iter()
            .map(|r| TreasuryTransfer {
                token_address: r.token_address,
                from_address: r.from_address,
                to_address: r.to_address,
                value: r.value,
                block_number: r.block_number,
                tx_hash: r.tx_hash,
                log_index: r.log_index,
            })
            .collect();
        Ok(out)
    }

    /// All proposals across every Governance module attached to a TRUST,
    /// identified by its on-chain trust_id (bytes32 hex). Newest first.
    /// `limit` defaults to 50; max 200.
    async fn proposals_for_trust(
        &self,
        ctx: &Context<'_>,
        trust_id: String,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<Proposal>> {
        let cap = limit.unwrap_or(50).clamp(1, 200) as u32;
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let rows = store::get_proposals_for_trust(&conn, &trust_id, cap)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Voting power for an account on a governance module. Returns the
    /// account's token balance (raw u256 hex) in the Token module that backs
    /// the given governance module. Returns `null` when the account has no
    /// indexed balance (no Transfer events yet, or balance is zero).
    async fn voting_power(
        &self,
        ctx: &Context<'_>,
        module_address: String,
        account_address: String,
    ) -> async_graphql::Result<Option<VotingPower>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let balance = store::get_voting_power(&conn, &module_address, &account_address)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(balance.map(|b| VotingPower {
            module_address: module_address.clone(),
            account_address: account_address.clone(),
            voting_power: b,
        }))
    }
}

pub type IndexerSchema = Schema<Query, EmptyMutation, EmptySubscription>;

/// Build the async-graphql Schema with the shared DB attached as context data.
pub fn build_schema(db: SharedDb) -> IndexerSchema {
    Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(db)
        .finish()
}

/// GraphQL POST handler.
async fn graphql_handler(
    Extension(schema): Extension<IndexerSchema>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

/// GraphiQL playground at GET /graphql.
async fn graphiql() -> impl IntoResponse {
    Html(GraphiQLSource::build().endpoint("/graphql").finish())
}

/// Build the axum router with the /graphql endpoint mounted.
pub fn build_router(schema: IndexerSchema) -> Router {
    Router::new()
        .route("/graphql", get(graphiql).post(graphql_handler))
        .route("/healthz", get(|| async { "ok" }))
        .layer(Extension(schema))
}

/// Serve the indexer API on the given port.
pub async fn serve(port: u16, db: SharedDb) -> Result<()> {
    let schema = build_schema(db);
    let router = build_router(schema);
    let addr = format!("0.0.0.0:{}", port);
    tracing::info!(
        "aeqi-indexer GraphQL serving on http://{} (POST /graphql, GET /graphql for GraphiQL, GET /healthz)",
        addr
    );
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;
    use tempfile::tempdir;

    async fn build_test_db() -> SharedDb {
        let dir = tempdir().unwrap();
        let conn = store::open(dir.path().join("test.db")).expect("open");
        // Leak the tempdir so it's not dropped during the test
        std::mem::forget(dir);
        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn graphql_returns_indexed_trust() {
        let db = build_test_db().await;
        // Seed one TRUST
        {
            let conn = db.lock().await;
            store::insert_trust_created(
                &conn,
                "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747",
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
                42,
                "0xabc",
            )
            .expect("insert");
        }

        let schema = build_schema(db);
        let q = r#"{ trust(address: "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747") { address creator_address: creatorAddress trustId createdBlock } trustsCount version }"#;
        let response = schema.execute(q).await;
        assert!(
            response.errors.is_empty(),
            "graphql errors: {:?}",
            response.errors
        );
        // Response data exists
        assert!(response.data != async_graphql::Value::Null);
    }
}
