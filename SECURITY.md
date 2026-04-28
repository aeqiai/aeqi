# Security Policy

We take security issues in aeqi seriously and appreciate responsible disclosure.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security reports.**

Email **0x@aeqi.io** with:

- A clear description of the issue and the impact you believe it has.
- Reproduction steps, a proof of concept, or a patch if you have one.
- The version, commit, or deployment context where you observed the issue.

We will acknowledge receipt within two business days and aim to provide a substantive response within seven days. Critical issues are triaged immediately.

If you would prefer to encrypt your report, request our PGP key at the same address.

## Disclosure Process

1. Report received and acknowledged.
2. We investigate, reproduce, and assess severity.
3. We work on a fix in a private branch.
4. We coordinate a release date with you.
5. We publish a fix and credit the reporter (unless you prefer to remain anonymous).

We do not currently operate a paid bug bounty program. We do credit reporters in release notes and security advisories.

## Supported Versions

Security fixes are issued against the latest minor release on `main`. Older versions are not supported.

## Scope

In scope:

- The runtime kernel and crates published in this repository.
- The reference web UI shipped from this repository.
- The official install scripts under `scripts/`.

Out of scope:

- Findings against forks, downstream redistributions, or modified deployments.
- Issues that require physical access, social engineering, or local privilege already on the host.
- Denial of service via volumetric load against self-hosted deployments.
- Vulnerabilities in third-party services that aeqi integrates with — please report those upstream.

## Operational Security Guidance

For deployment hardening, environment variables, and security headers, see [`docs/security/configuration.md`](docs/security/configuration.md).

For the historical record of the April 2026 hardening pass, see [`docs/security/hardening-2026-04.md`](docs/security/hardening-2026-04.md).
