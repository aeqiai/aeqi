# ── Stage 1: Build dashboard UI ──
FROM node:22-slim AS ui
WORKDIR /build/apps/ui
COPY apps/ui/package.json apps/ui/package-lock.json ./
RUN npm ci --silent
COPY apps/ui/ ./
RUN npm run build

# ── Stage 2: Build Rust binary ──
FROM rust:1-slim AS build
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Cache dependencies: copy manifests first, then source.
COPY Cargo.toml Cargo.lock ./
COPY aeqi-cli/Cargo.toml aeqi-cli/Cargo.toml
COPY crates/ crates/
# Stub main.rs so cargo can resolve the workspace.
RUN mkdir -p aeqi-cli/src && echo "fn main(){}" > aeqi-cli/src/main.rs
RUN cargo build --release -p aeqi 2>/dev/null || true
# Now copy real source + UI dist and build for real.
COPY aeqi-cli/ aeqi-cli/
COPY --from=ui /build/apps/ui/dist apps/ui/dist
RUN cargo build --release -p aeqi

# ── Stage 3: Runtime ──
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/aeqi /usr/local/bin/aeqi
RUN useradd -m aeqi
USER aeqi
WORKDIR /home/aeqi
EXPOSE 8400
ENTRYPOINT ["aeqi"]
CMD ["start"]
