# Contributing

AEQI is a monorepo with a Rust backend and a React UI.

## Development Setup

```bash
cp config/aeqi.example.toml config/aeqi.toml
npm run ui:install
cargo build
```

Use `config/aeqi.toml` for local-only settings. It is intentionally not meant to be committed.

## Common Commands

```bash
cargo test
cargo fmt --all
cargo clippy -- -D warnings
npm run ui:build
npm run ui:dev
```

## Pull Requests

- Keep changes focused.
- Include verification for the area you touched.
- Update docs when behavior, config, or operator workflow changes.
- Do not commit local secrets or machine-specific config.
