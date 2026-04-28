# Test fixtures

These files are used by unit and integration tests in `aeqi-core`. They are **not** secrets and **not** used by any real code path.

## `test_rsa_private.pem`

A throwaway 2048-bit RSA key generated solely for exercising the credential-substrate parsing tests. It has never been associated with any service, account, or user. Secret scanners can safely ignore it (see `/.gitleaks.toml` at the repo root).

If you ever need to regenerate it:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out test_rsa_private.pem
```
