#!/usr/bin/env bash
# Install aeqi — downloads the latest pre-built binary for your platform
# and verifies its SHA-256 checksum against the signed release manifest.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | sh
#
# Environment variables:
#   AEQI_VERSION     — Pin a specific version (e.g. v0.14.0). Default: latest.
#   AEQI_INSTALL_DIR — Install directory. Default: /usr/local/bin.
#   AEQI_SKIP_VERIFY — Set to 1 to skip checksum verification (NOT recommended).

set -eu
# pipefail isn't in plain POSIX sh but every modern /bin/sh (bash, dash, busybox
# ash, zsh-as-sh) supports it; opt in only if the running shell does.
( set -o pipefail 2>/dev/null ) && set -o pipefail

REPO="aeqiai/aeqi"
INSTALL_DIR="${AEQI_INSTALL_DIR:-/usr/local/bin}"
SKIP_VERIFY="${AEQI_SKIP_VERIFY:-0}"

# ── prerequisites ────────────────────────────────────────────────────────

need() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: required tool '$1' not found in PATH" >&2
        exit 1
    }
}
need curl
need uname
need chmod
need mv

# Pick a SHA-256 binary — sha256sum on Linux, shasum -a 256 on macOS.
SHASUM=""
if command -v sha256sum >/dev/null 2>&1; then
    SHASUM="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    SHASUM="shasum -a 256"
fi
if [ -z "$SHASUM" ] && [ "$SKIP_VERIFY" != "1" ]; then
    echo "error: neither sha256sum nor shasum found — install one, or" >&2
    echo "       re-run with AEQI_SKIP_VERIFY=1 (not recommended)" >&2
    exit 1
fi

# ── platform detection ───────────────────────────────────────────────────

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64|amd64)   ARCH="amd64" ;;
    aarch64|arm64)  ARCH="arm64" ;;
    *) echo "error: unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

case "$OS" in
    linux)  PLATFORM="linux" ;;
    darwin) PLATFORM="darwin" ;;
    *) echo "error: unsupported OS: $OS" >&2; exit 1 ;;
esac

ARTIFACT="aeqi-${PLATFORM}-${ARCH}"

# ── version resolution ───────────────────────────────────────────────────

if [ -z "${AEQI_VERSION:-}" ]; then
    AEQI_VERSION=$(
        curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
            | grep '"tag_name"' \
            | head -1 \
            | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
    )
    if [ -z "$AEQI_VERSION" ]; then
        echo "error: failed to determine latest version" >&2
        echo "       check https://github.com/${REPO}/releases or pin AEQI_VERSION" >&2
        exit 1
    fi
fi

BASE_URL="https://github.com/${REPO}/releases/download/${AEQI_VERSION}"
BIN_URL="${BASE_URL}/${ARTIFACT}"
SUMS_URL="${BASE_URL}/SHA256SUMS.txt"

# ── isolated working dir + cleanup ───────────────────────────────────────

TMPDIR_AEQI=$(mktemp -d 2>/dev/null || mktemp -d -t aeqi-install)
trap 'rm -rf "$TMPDIR_AEQI"' EXIT INT TERM

TMP_BIN="${TMPDIR_AEQI}/aeqi"
TMP_SUMS="${TMPDIR_AEQI}/SHA256SUMS.txt"

# ── download ─────────────────────────────────────────────────────────────

echo "Installing aeqi ${AEQI_VERSION} (${PLATFORM}/${ARCH})..."

if ! curl -fsSL "$BIN_URL" -o "$TMP_BIN"; then
    echo "error: failed to download $BIN_URL" >&2
    exit 1
fi

# ── verify ───────────────────────────────────────────────────────────────

if [ "$SKIP_VERIFY" = "1" ]; then
    echo "  warning: AEQI_SKIP_VERIFY=1 — skipping checksum verification"
else
    if ! curl -fsSL "$SUMS_URL" -o "$TMP_SUMS"; then
        echo "error: failed to download checksum manifest $SUMS_URL" >&2
        echo "       set AEQI_SKIP_VERIFY=1 to bypass (not recommended)" >&2
        exit 1
    fi

    EXPECTED=$(grep "${ARTIFACT}\$" "$TMP_SUMS" | head -1 | awk '{print $1}')
    if [ -z "$EXPECTED" ]; then
        echo "error: no entry for ${ARTIFACT} in SHA256SUMS.txt" >&2
        exit 1
    fi

    ACTUAL=$($SHASUM "$TMP_BIN" | awk '{print $1}')
    if [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "error: checksum mismatch for ${ARTIFACT}" >&2
        echo "       expected: $EXPECTED" >&2
        echo "       actual:   $ACTUAL" >&2
        exit 1
    fi
    echo "  verified sha256: ${ACTUAL}"
fi

chmod +x "$TMP_BIN"

# ── install ──────────────────────────────────────────────────────────────

if [ ! -d "$INSTALL_DIR" ]; then
    echo "error: install dir does not exist: $INSTALL_DIR" >&2
    echo "       create it or set AEQI_INSTALL_DIR to a directory in your PATH" >&2
    exit 1
fi

if [ -e "${INSTALL_DIR}/aeqi" ]; then
    echo "  replacing existing ${INSTALL_DIR}/aeqi"
fi

if [ -w "$INSTALL_DIR" ]; then
    mv "$TMP_BIN" "${INSTALL_DIR}/aeqi"
else
    if ! command -v sudo >/dev/null 2>&1; then
        echo "error: ${INSTALL_DIR} is not writable and sudo is unavailable" >&2
        echo "       set AEQI_INSTALL_DIR to a writable directory (e.g. \$HOME/.local/bin)" >&2
        exit 1
    fi
    sudo mv "$TMP_BIN" "${INSTALL_DIR}/aeqi"
fi

echo ""
echo "  aeqi installed to ${INSTALL_DIR}/aeqi"
echo ""
echo "  Get started:"
echo "    aeqi setup     # configure provider + API key"
echo "    aeqi start     # start daemon + dashboard on localhost:8400"
echo ""
