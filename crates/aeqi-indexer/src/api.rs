//! HTTP + GraphQL API. Mirrors the subgraph's query surface for indexed data.

use anyhow::Result;
use async_graphql::{
    http::GraphiQLSource, Context, EmptyMutation, EmptySubscription, Object, Schema, SimpleObject,
};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    response::{Html, IntoResponse},
    routing::get,
    Extension, Router,
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
#[derive(SimpleObject, Clone)]
pub struct Signer {
    pub trust_address: String,
    pub signer_address: String,
    pub address_key: String,
    pub has_signed: bool,
    pub added_block: u64,
    pub added_tx: String,
}

impl From<store::SignerRow> for Signer {
    fn from(r: store::SignerRow) -> Self {
        Signer {
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
#[derive(SimpleObject, Clone)]
pub struct Trust {
    /// Contract address (hex string).
    pub address: String,
    /// On-chain trust ID (bytes32 as hex).
    pub trust_id: String,
    /// Address that called Factory to create this TRUST.
    pub creator_address: String,
    /// Template the TRUST was registered with (if any).
    pub template_id: Option<String>,
    /// IPFS CID of off-chain metadata (if any).
    pub ipfs_cid: Option<String>,
    /// Number of authorized signers at registration time.
    pub signers_count: Option<i64>,
    /// Number of value-config slots at registration time.
    pub value_configs_count: Option<i64>,
    /// Block number where the TRUST was created.
    pub created_block: u64,
    /// Transaction hash that created the TRUST.
    pub created_tx: String,
}

impl From<store::TrustRow> for Trust {
    fn from(r: store::TrustRow) -> Self {
        Trust {
            address: r.address,
            trust_id: r.trust_id,
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
    /// Look up a single TRUST by its on-chain address.
    async fn trust(&self, ctx: &Context<'_>, address: String) -> async_graphql::Result<Option<Trust>> {
        let db = ctx.data::<SharedDb>()?;
        let conn = db.lock().await;
        let row = store::get_trust(&conn, &address).map_err(|e| async_graphql::Error::new(e.to_string()))?;
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
    tracing::info!("aeqi-indexer GraphQL serving on http://{} (POST /graphql, GET /graphql for GraphiQL, GET /healthz)", addr);
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
        assert!(response.errors.is_empty(), "graphql errors: {:?}", response.errors);
        // Response data exists
        assert!(response.data != async_graphql::Value::Null);
    }
}
