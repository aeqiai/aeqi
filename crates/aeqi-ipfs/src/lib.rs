//! aeqi-ipfs — Kubo HTTP-API client for IPFS content-addressed storage.
//!
//! Wraps the four primary kubo RPC endpoints used by the aeqi TRUST provisioner:
//! `/api/v0/add` (pin bytes), `/api/v0/cat` (fetch by CID),
//! `/api/v0/pin/add` (re-pin a known CID), `/api/v0/pin/rm` (unpin).
//!
//! The client talks to a locally-running kubo daemon. The default base URL
//! (`http://127.0.0.1:5001`) is correct for the aeqi-ipfs.service systemd unit.
//! Override via [`IpfsClient::new`] for tests or remote nodes.

pub mod error;

pub use error::IpfsError;

/// Opaque CID string as returned by kubo (base32 CIDv1, e.g.
/// `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`).
pub type Cid = String;

/// Kubo HTTP-API client.
///
/// Cheap to clone — the inner `reqwest::Client` is `Arc`-backed.
#[derive(Clone, Debug)]
pub struct IpfsClient {
    base_url: String,
    http: reqwest::Client,
}

impl IpfsClient {
    /// Construct a client pointing at `base_url`.
    ///
    /// For production use, pass `"http://127.0.0.1:5001"` (the default kubo
    /// listen address). The trailing slash is optional; the client normalises it.
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_owned();
        Self {
            base_url,
            http: reqwest::Client::new(),
        }
    }

    /// Construct a client pointing at the default kubo daemon
    /// (`http://127.0.0.1:5001`).
    pub fn default_local() -> Self {
        Self::new("http://127.0.0.1:5001")
    }

    /// Upload raw bytes to IPFS via multipart `POST /api/v0/add`.
    ///
    /// Returns the CID assigned by kubo. The content is pinned automatically
    /// by kubo's default `pin=true` behaviour.
    #[tracing::instrument(skip(self, bytes), fields(len = bytes.len()))]
    pub async fn add(&self, bytes: Vec<u8>) -> Result<Cid, IpfsError> {
        let url = format!("{}/api/v0/add", self.base_url);
        let part = reqwest::multipart::Part::bytes(bytes).file_name("file");
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = self.http.post(&url).multipart(form).send().await?;
        let status = resp.status();
        let body = resp.text().await?;

        if !status.is_success() {
            return Err(IpfsError::Decode(format!(
                "POST /api/v0/add returned {status}: {body}"
            )));
        }

        // kubo returns newline-delimited JSON (NDJSON) for streamed adds;
        // with a single file and no `?stream-channels=true` override the
        // response is a single JSON object on one line.
        let json: serde_json::Value = serde_json::from_str(body.trim()).map_err(|e| {
            IpfsError::Decode(format!("add response is not valid JSON ({e}): {body}"))
        })?;

        let cid = json
            .get("Hash")
            .and_then(|v| v.as_str())
            .ok_or(IpfsError::MissingCid)?
            .to_owned();

        tracing::debug!(cid, "add complete");
        Ok(cid)
    }

    /// Fetch the raw bytes for a CID via `POST /api/v0/cat?arg=<cid>`.
    #[tracing::instrument(skip(self))]
    pub async fn fetch(&self, cid: &str) -> Result<Vec<u8>, IpfsError> {
        let url = format!("{}/api/v0/cat?arg={cid}", self.base_url);
        let resp = self.http.post(&url).send().await?;
        let status = resp.status();

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(IpfsError::Decode(format!(
                "POST /api/v0/cat returned {status}: {body}"
            )));
        }

        let bytes = resp.bytes().await?.to_vec();
        tracing::debug!(cid, len = bytes.len(), "fetch complete");
        Ok(bytes)
    }

    /// Pin an existing CID via `POST /api/v0/pin/add?arg=<cid>`.
    #[tracing::instrument(skip(self))]
    pub async fn pin_add(&self, cid: &str) -> Result<(), IpfsError> {
        let url = format!("{}/api/v0/pin/add?arg={cid}", self.base_url);
        let resp = self.http.post(&url).send().await?;
        let status = resp.status();

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(IpfsError::Decode(format!(
                "POST /api/v0/pin/add returned {status}: {body}"
            )));
        }

        tracing::debug!(cid, "pin_add complete");
        Ok(())
    }

    /// Unpin a CID via `POST /api/v0/pin/rm?arg=<cid>`.
    #[tracing::instrument(skip(self))]
    pub async fn unpin(&self, cid: &str) -> Result<(), IpfsError> {
        let url = format!("{}/api/v0/pin/rm?arg={cid}", self.base_url);
        let resp = self.http.post(&url).send().await?;
        let status = resp.status();

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(IpfsError::Decode(format!(
                "POST /api/v0/pin/rm returned {status}: {body}"
            )));
        }

        tracing::debug!(cid, "unpin complete");
        Ok(())
    }

    /// Health check — calls `POST /api/v0/version` and expects a 200 response.
    ///
    /// Returns `Ok(())` when the daemon is reachable and responding. Returns
    /// [`IpfsError::Unhealthy`] otherwise.
    #[tracing::instrument(skip(self))]
    pub async fn health(&self) -> Result<(), IpfsError> {
        let url = format!("{}/api/v0/version", self.base_url);
        let resp = self
            .http
            .post(&url)
            .send()
            .await
            .map_err(|e| IpfsError::Unhealthy(format!("connection failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(IpfsError::Unhealthy(format!(
                "version returned {status}: {body}"
            )));
        }

        tracing::debug!("health check passed");
        Ok(())
    }
}
