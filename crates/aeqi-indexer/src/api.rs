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
