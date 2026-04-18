# Contributing

AEQI is a monorepo: a Rust workspace (`aeqi-cli` + `crates/*`) and a React dashboard (`apps/ui`). Thanks for considering a contribution.

## Before You Start

- Security issues → **do not** open a public issue. See [SECURITY.md](SECURITY.md) for private disclosure.
- Non-trivial changes → open an issue or discussion first so we can align on scope before code is written.
- House rules lives in [CLAUDE.md](CLAUDE.md) (also applies to humans): zero warnings, zero clippy lints, no dead code, no backward-compat shims.

## Development Setup

```bash
cp config/aeqi.example.toml config/aeqi.toml   # local-only, not committed
npm run ui:install
cargo build
```

To run the full stack locally:

```bash
aeqi setup         # one-time: generates config and seeds a root agent
aeqi start         # daemon + dashboard on :8400
```

## Common Commands

| Area | Command |
|------|---------|
| Rust build | `cargo build` |
| Rust tests | `cargo test --workspace` |
| Rust lint | `cargo clippy --workspace -- -D warnings` |
| Rust format | `cargo fmt --all` |
| UI build | `npm run ui:build` |
| UI dev server | `npm run ui:dev` (proxies `/api` to `:8400`) |
| UI type check | `cd apps/ui && npx tsc --noEmit` |
| UI format check | `cd apps/ui && npx prettier --check "src/**/*.{ts,tsx,css}"` |
| UI tests | `cd apps/ui && npm test` |

All of the above must pass before a PR merges. The pre-commit hook (Husky) runs the UI checks automatically when `apps/ui` files change.

## Commit Messages

We follow a lightweight Conventional Commits style. The type up front makes release notes mechanical to assemble:

```
<type>(<optional scope>): <short imperative summary>

<optional body — the "why", linked issues, breaking changes>
```

Common types in this repo:

| Type | When to use |
|------|-------------|
| `feat` | New user-visible capability |
| `fix` | Bug fix |
| `refactor` | Behaviour-preserving code change |
| `test` | Test-only changes |
| `docs` | Documentation only |
| `style(ui)` | CSS / visual-only UI tweaks |
| `chore` | Tooling, CI, dependencies, repo meta |

Scopes are free-form; common ones include `ui`, `deploy`, `ideas`, `channels`, `meta`.

Keep the summary under ~70 characters. Use the body to explain *why*, not *what* — the diff already shows what.

## Pull Requests

Use the PR template — it prompts for a summary, a type, and a verification checklist.

- **Keep changes focused.** Prefer several small PRs over one sprawling one.
- **Include verification** for every layer you touched: `cargo clippy`, `cargo test`, `tsc --noEmit`, `npm test`, and any manual smoke test that is relevant.
- **Update docs** when behaviour, config, or operator workflow changes. The `docs/` directory is user-facing; internal notes should stay out.
- **Do not commit secrets** or machine-specific config. If you accidentally stage `config/aeqi.toml` or similar, unstage before committing.

## Filing Issues

Use a template from [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE):

- **Bug report** — a reproducible defect.
- **Feature request** — a change in user-facing behaviour.
- For anything else, start a [GitHub Discussion](https://github.com/aeqiai/aeqi/discussions) first.

## License

By contributing, you agree that your contributions will be licensed under the [Business Source License 1.1](LICENSE) that covers the rest of the project, which converts to Apache 2.0 on the stated Change Date.
