# Quality Gates for AEQI CI/CD Pipeline

This document describes the comprehensive quality gates implemented in the AEQI CI/CD pipeline.

## Overview

The quality gates workflow (`quality-gates.yml`) runs on every push to the `main` branch and on every pull request targeting `main`. It also runs weekly for security audits. The workflow ensures code quality, security, and performance standards are maintained.

## Quality Gates

### 1. Security Vulnerability Scanning (cargo-audit)
- **Tool**: `cargo-audit`
- **Purpose**: Scans dependencies for known security vulnerabilities
- **Configuration**: Uses RustSec advisory database
- **Failure Condition**: Any critical/high severity vulnerabilities found

### 2. Dependency Analysis (cargo-deny)
- **Tool**: `cargo-deny`
- **Purpose**: Comprehensive dependency checking including:
  - License compliance (allowed: Apache-2.0, MIT, BSD-3-Clause, BSL-1.1, ISC, Unlicense, Zlib)
  - Multiple version detection (warns on >3 versions)
  - Yanked crate detection
  - Unmaintained crate warnings
  - Unsound crate detection
- **Configuration**: See `deny.toml`
- **Failure Condition**: License violations, yanked crates, unsound crates

### 3. Dead Code Detection (cargo-udeps)
- **Tool**: `cargo-udeps`
- **Purpose**: Identifies unused dependencies
- **Note**: Requires nightly Rust toolchain
- **Failure Condition**: Unused dependencies found

### 4. Code Coverage Reporting (cargo-tarpaulin)
- **Tool**: `cargo-tarpaulin`
- **Purpose**: Measures test code coverage
- **Output**: Lcov format report in `./coverage/`
- **Artifact**: Uploaded as `coverage-report`

### 5. Performance Regression Detection
- **Tool**: `cargo-criterion` + custom detection script
- **Purpose**: Detects performance regressions
- **Components**:
  - Benchmark execution with `cargo-criterion`
  - Baseline creation on main branch
  - Regression detection via `scripts/performance-regression-detection.sh`
- **Artifacts**: 
  - `benchmark-results`: Raw criterion results
  - `performance-baseline.json`: Baseline for comparison

### 6. Code Quality Checks
- **Formatting**: `cargo fmt --check`
- **Linting**: `cargo clippy --workspace -- -D warnings`
- **Build Verification**: `cargo build --workspace`
- **Testing**: `cargo test --workspace`

### 7. Documentation Generation
- **Tool**: `cargo doc`
- **Purpose**: Ensures documentation builds successfully
- **Artifact**: `documentation` (HTML docs)

## Running Locally

### Install Required Tools
```bash
# Install Rust toolchain (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install quality gate tools
cargo install cargo-audit --locked
cargo install cargo-deny --locked
cargo install cargo-udeps --locked
cargo install cargo-tarpaulin --locked
cargo install cargo-criterion --locked

# Install nightly for cargo-udeps
rustup toolchain install nightly
```

### Run Individual Checks
```bash
# Security audit
cargo audit

# Dependency analysis
cargo deny check

# Unused dependencies (requires nightly)
cargo +nightly udeps --workspace

# Code coverage
cargo tarpaulin --workspace --out Lcov --output-dir ./coverage

# Performance benchmarks
cargo criterion

# Code formatting
cargo fmt --check --all

# Linting
cargo clippy --workspace -- -D warnings
```

### Run All Quality Gates
```bash
# Run the complete quality gate suite
./scripts/performance-regression-detection.sh  # For performance checks
# Other checks as above
```

## Configuration Files

### `deny.toml`
Configuration for `cargo-deny` including:
- Allowed licenses
- Security advisory settings
- Multiple version policies
- Source restrictions

### `rust-toolchain.toml`
Specifies the Rust toolchain version.

## Artifacts

The workflow generates and uploads the following artifacts:
1. `coverage-report`: Code coverage reports in Lcov format
2. `benchmark-results`: Raw criterion benchmark results
3. `performance-baseline.json`: Performance baseline for regression detection
4. `documentation`: Generated Rust documentation

## Troubleshooting

### Common Issues

1. **cargo-udeps fails**: Requires nightly Rust. Install with `rustup toolchain install nightly`.
2. **Performance baseline missing**: Run benchmarks on main branch first to establish baseline.
3. **License violations**: Check `deny.toml` for allowed licenses.
4. **Security vulnerabilities**: Update dependencies or add advisories to ignore list in `deny.toml`.

### Debugging Workflow
- Check workflow logs in GitHub Actions
- Run individual checks locally to reproduce issues
- Review artifact contents for detailed reports

## Adding New Quality Gates

To add a new quality gate:

1. Add tool installation in the "Install quality gate tools" step
2. Add a new step with the check
3. Update the summary report
4. Document the new gate in this README

## Performance Baseline Management

The performance baseline (`benchmark-baseline.json`) is automatically created when benchmarks run on the main branch. To update the baseline:

1. Ensure benchmarks pass on your branch
2. Merge to main
3. The workflow will create/update the baseline automatically

For manual baseline updates, run:
```bash
cargo criterion --message-format=json | jq -s '.' > benchmark-baseline.json
```

## Security Considerations

- Weekly security audits run automatically
- All dependencies are scanned for vulnerabilities
- License compliance is enforced
- Only crates from crates.io are allowed (no git/path dependencies unless explicitly configured)

## Contributing

When contributing to AEQI, ensure all quality gates pass:
1. Run quality gates locally before pushing
2. Address any warnings or failures
3. Update documentation if adding new dependencies or changing code patterns
4. Consider adding benchmarks for performance-critical code