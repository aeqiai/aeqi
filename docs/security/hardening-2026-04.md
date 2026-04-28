# Security Hardening Pass — April 2026

Snapshot of the security audit and remediation work completed in early 2026. Kept as a historical record so reviewers can see what was assessed and shipped. For current security configuration see [`configuration.md`](configuration.md); for vulnerability disclosure see [`/SECURITY.md`](../../SECURITY.md).

## Scope

The pass covered:

- Sandbox escape vectors in the bubblewrap implementation
- Authentication and authorization surfaces
- SQL injection paths
- Input validation across API endpoints
- Path traversal in file tools
- Secret leakage in logs
- Session management

## What shipped

### Authentication
- Removed the default fallback JWT secret (`aeqi-ephemeral-fallback`).
- `AEQI_AUTH_SECRET` is now required; missing or empty values return an error rather than silently falling back.
- Files: `crates/aeqi-web/src/auth.rs`.

### Path traversal protection
- New `secure_path` module in `aeqi-core` performing null-byte detection, `..` sequence detection, control-character validation, and symlink-aware canonicalization with workspace-boundary checking.
- Separate validation paths for read and write operations.
- File tools (`FileReadTool`, `FileWriteTool`, `ListDirTool`) updated to route through the secure utilities.
- Files: `crates/aeqi-core/src/secure_path.rs`, `crates/aeqi-tools/src/file.rs`.

### Security headers middleware
- `aeqi-web` security middleware emitting Content-Security-Policy, Strict-Transport-Security (1y, includeSubDomains), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, and a restrictive Permissions-Policy.
- Files: `crates/aeqi-web/src/security_middleware.rs`.

### Rate limiting middleware
- Configurable per-IP request budgets, automatic 5-minute block on exceedance, RFC 6585 `X-RateLimit-*` headers, periodic cleanup of stale entries.
- Files: `crates/aeqi-web/src/rate_limit.rs`.

### Test coverage
- Security regression suite covering path traversal, SQL parameterization, token tampering, secure file ops, sandbox isolation, and rate limiting.
- Files: `crates/*/tests/security_*.rs`.

## Known follow-ups

These were identified during the pass but not in scope for the April cut. They remain open:

- Token revocation / refresh mechanism (currently JWTs are valid until expiry).
- Session timeout enforcement and concurrent-session limits.
- Atomic path resolution (`openat`-style) to close TOCTOU windows between `canonicalize` and the subsequent file operation.
- Systematic secret redaction in `tracing` output.
- CSRF protection on web forms.
- User namespace isolation (`--unshare-user`) in the bubblewrap profile.
- Wiring security checks (cargo-audit, cargo-deny, secret scan) into CI.

## Severity at point-of-audit

Recorded for completeness; severities reflect the codebase as audited in April 2026 and may not match current state.

| Area | Highest severity at audit | Status |
| --- | --- | --- |
| JWT default fallback | High | Fixed |
| Path traversal in file tools | High | Fixed |
| Sandbox fallback when bwrap absent | High | Mitigated (explicit opt-in) |
| Missing security headers | Medium | Fixed |
| No rate limiting | Medium | Fixed |
| Token revocation | Medium | Open |
| TOCTOU on canonicalize | Medium | Open |
| Secret redaction in logs | Medium | Open |
| CSRF on web forms | Medium | Open |
