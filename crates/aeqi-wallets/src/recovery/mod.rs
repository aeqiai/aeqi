//! BIP-39 mnemonic generation and seed reconstruction.
//!
//! The mnemonic is derived from the original keypair entropy at provisioning
//! time. Users can reveal it on demand via the platform endpoint. Master KEK
//! loss does NOT brick recovery: the user's client share + (optionally)
//! revealed seed lets them reconstruct the private key without server help.
