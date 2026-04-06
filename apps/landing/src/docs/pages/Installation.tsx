export default function Installation() {
  return (
    <>
      <h1>Installation</h1>
      <p className="lead">
        Three ways to install aeqi. All produce the same single binary.
      </p>

      <h2>Install script (recommended)</h2>
      <p>Detects your OS and architecture, downloads the latest release binary.</p>
      <pre><code>{`curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | sh`}</code></pre>
      <p>Supports Linux (amd64, arm64), macOS (amd64, arm64), and WSL.</p>

      <h2>Cargo</h2>
      <p>Build from source with the Rust toolchain.</p>
      <pre><code>{`cargo install aeqi`}</code></pre>
      <p>Requires Rust stable. The UI is embedded in the binary at compile time via rust-embed.</p>

      <h2>Docker</h2>
      <pre><code>{`git clone https://github.com/aeqiai/aeqi && cd aeqi
cp config/aeqi.example.toml config/aeqi.toml
docker compose up`}</code></pre>

      <h2>From source</h2>
      <pre><code>{`git clone https://github.com/aeqiai/aeqi && cd aeqi
cd apps/ui && npm ci && npm run build && cd ../..
cargo build --release
./target/release/aeqi start`}</code></pre>

      <h2>Requirements</h2>
      <ul>
        <li><strong>Runtime:</strong> None. The binary is self-contained (SQLite bundled, UI embedded).</li>
        <li><strong>LLM provider:</strong> An API key from OpenRouter, Anthropic, or a local Ollama instance.</li>
        <li><strong>Build from source:</strong> Rust stable + Node.js 22+ (for the UI build step).</li>
      </ul>

      <h2>Verify installation</h2>
      <pre><code>{`aeqi --version
aeqi doctor --strict`}</code></pre>
    </>
  );
}
