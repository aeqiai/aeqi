# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in AEQI, please report it privately. **Do not open a public GitHub issue.**

Email: **security@aeqi.ai**

Please include:

- A description of the issue and its impact
- Steps to reproduce (proof-of-concept code, request payloads, etc.)
- Affected version(s) or commit hash
- Any suggested mitigation

## Response

- **Acknowledgement**: within 72 hours
- **Initial assessment**: within 7 days
- **Fix + disclosure timeline**: coordinated with the reporter; typically within 90 days of acknowledgement, sooner for actively exploited issues

We will credit reporters in release notes unless anonymity is requested.

## Scope

In scope:

- The AEQI runtime (`crates/`, `aeqi-cli/`)
- The web control plane (`apps/ui/`)
- Tenancy and scoping logic (agent tree, `allowed_roots`)
- Credential handling, secret storage, session tokens
- Sandbox escape from `bwrap`-isolated agent execution

Out of scope:

- Issues in third-party dependencies without a demonstrable impact on AEQI (report upstream first)
- Vulnerabilities requiring physical access to the host
- Self-XSS, clickjacking on unauthenticated pages without state change
- Rate-limiting or brute-force concerns on public endpoints already behind a WAF
- Findings against the aeqi.ai marketing site (separate repo)

## Supported Versions

AEQI is pre-1.0. Only the latest `main` and the most recent tagged release receive security fixes.
