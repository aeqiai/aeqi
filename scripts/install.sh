#!/usr/bin/env bash
set -euo pipefail

# aeqi one-liner installer
# Usage: curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | bash
#
# Installs aeqi from source (Rust required). For pre-built binaries, see
# https://github.com/aeqiai/aeqi/releases

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

AEQI_REPO="https://github.com/aeqiai/aeqi.git"
AEQI_HOME="${AEQI_HOME:-$HOME/.aeqi}"
AEQI_INSTALL_DIR="${AEQI_INSTALL_DIR:-$HOME/.aeqi/aeqi}"
CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"

banner() {
    echo ""
    echo -e "${CYAN}${BOLD}    ⚕  aeqi installer${RESET}"
    echo -e "    agent runtime for autonomous work"
    echo ""
}

check_dep() {
    if ! command -v "$1" &>/dev/null; then
        echo -e "  ${RED}✗${RESET} $1 not found — please install it first"
        return 1
    fi
    echo -e "  ${GREEN}✓${RESET} $1 ($(command -v "$1"))"
}

main() {
    banner

    echo -e "${BOLD}Checking prerequisites...${RESET}"
    check_dep rustc || {
        echo ""
        echo -e "  Rust is required to build aeqi."
        echo -e "  Install it: ${CYAN}curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${RESET}"
        exit 1
    }
    check_dep cargo
    check_dep git || true  # optional — can use cargo install from crates.io

    echo ""
    echo -e "${BOLD}Building aeqi...${RESET}"

    if [ -d "$AEQI_INSTALL_DIR" ]; then
        echo -e "  ${YELLOW}⚠${RESET}  existing checkout at $AEQI_INSTALL_DIR — updating..."
        cd "$AEQI_INSTALL_DIR"
        git pull --ff-only origin main 2>/dev/null || true
    else
        mkdir -p "$(dirname "$AEQI_INSTALL_DIR")"
        git clone --depth 1 "$AEQI_REPO" "$AEQI_INSTALL_DIR"
        cd "$AEQI_INSTALL_DIR"
    fi

    echo "  Building release binary..."
    cargo build --release -p aeqi 2>&1 | tail -3

    local bin_path="$AEQI_INSTALL_DIR/target/release/aeqi"

    if [ ! -f "$bin_path" ]; then
        echo -e "  ${RED}✗${RESET} Build failed — binary not found at $bin_path"
        exit 1
    fi

    echo -e "  ${GREEN}✓${RESET} Built $("$bin_path" --version 2>/dev/null || echo "aeqi")"

    # Symlink to PATH
    local link_dest="$CARGO_HOME/bin/aeqi"
    if [ -f "$link_dest" ]; then
        echo -e "  ${YELLOW}⚠${RESET}  $link_dest already exists"
    else
        mkdir -p "$CARGO_HOME/bin"
        ln -sf "$bin_path" "$link_dest"
        echo -e "  ${GREEN}✓${RESET} Linked → $link_dest"
    fi

    # Ensure ~/.cargo/bin is in PATH for this session
    case ":$PATH:" in
        *:"$CARGO_HOME/bin":*) ;;
        *) export PATH="$CARGO_HOME/bin:$PATH" ;;
    esac

    echo ""
    echo -e "${BOLD}Setting up...${RESET}"

    # Run setup (non-interactive, writes config + seeds agents)
    "$bin_path" setup 2>&1 | tail -5

    echo ""
    echo -e "${GREEN}${BOLD}  ✓ aeqi installed${RESET}"
    echo ""
    echo -e "  Next steps:"
    echo -e "    ${BOLD}1.${RESET}  Add your API key:  ${CYAN}aeqi secrets set OPENROUTER_API_KEY <key>${RESET}"
    echo -e "    ${BOLD}2.${RESET}  Check everything:   ${CYAN}aeqi doctor --strict${RESET}"
    echo -e "    ${BOLD}3.${RESET}  Start the daemon:    ${CYAN}aeqi start${RESET}"
    echo -e "    ${BOLD}4.${RESET}  Chat with an agent:  ${CYAN}aeqi${RESET}"
    echo ""

    # Shell PATH reminder if needed
    if ! echo "$PATH" | grep -q "$CARGO_HOME/bin"; then
        echo -e "  ${YELLOW}⚠${RESET}  Add to your shell profile:"
        echo -e "    ${CYAN}export PATH=\"\$HOME/.cargo/bin:\$PATH\"${RESET}"
        echo ""
    fi
}

main "$@"
