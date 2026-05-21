# Local demo — no API key required

This walkthrough gets you from zero to a chatting agent without paying anyone. Everything runs on your machine: a local Ollama model for inference, SQLite for state, the embedded dashboard for UI.

Time: ~10 minutes the first time (most of it is the model download). About 30 seconds on every run after that.

## What you need

- Linux or macOS. Windows users should build from source and run the daemon manually.
- ~5 GB free disk: ~400 MB for the smallest Ollama model, the rest for `target/release` and the SQLite databases under `~/.aeqi/`.
- About 8 GB of RAM. The default model fits in 4 GB; bigger models are happier with more.

## Step 1 — Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:0.5b   # ~400 MB, fastest small model
```

Verify it's running:

```bash
curl -s http://localhost:11434/api/tags | head -c 80
```

You should see a JSON response listing the model you just pulled. If `curl` returns an error, start Ollama:

```bash
ollama serve &
```

## Step 2 — Install aeqi

```bash
curl -fsSL https://raw.githubusercontent.com/aeqi-ai/aeqi/main/scripts/install.sh | sh
```

The script downloads a pre-built binary (Linux amd64 or Darwin arm64) and verifies its SHA-256. For platforms it doesn't publish, it tells you to build from source — `cargo build --release -p aeqi` and copy the binary into your PATH.

## Step 3 — Configure for Ollama

```bash
aeqi setup --runtime ollama_agent
```

Setup is non-interactive. By default it writes a starter config to
`~/.aeqi/aeqi.toml`, seeds an `assistant` orchestrator agent under `~/.aeqi/`,
and generates a stable dashboard secret. It prints the secret on stdout — copy
it; you'll paste it on the dashboard sign-in screen.

If you run setup from a git checkout, it still keeps runtime files in `~/.aeqi/`
and prints a note. Use `aeqi setup --workspace --runtime ollama_agent` only when
you intentionally want repo-local `config/aeqi.toml` and `agents/` files in that
checkout.

The default model in the rendered config is `llama3.1:8b`. To use the smaller `qwen2.5:0.5b` you just pulled, edit `~/.aeqi/aeqi.toml` and change:

```toml
[providers.ollama]
url = "http://localhost:11434"
default_model = "qwen2.5:0.5b"
```

## Step 4 — Verify

```bash
aeqi doctor --strict
```

You should see something like:

```
[OK]   Config: ~/.aeqi/aeqi.toml
[OK]   Default runtime: ollama_agent
[OK]   Ollama reachable at http://localhost:11434
[OK]   Agent 'assistant': agent.md | runtime=ollama | mode=Agent | model=qwen2.5:0.5b
[OK]   Secret store: ~/.aeqi/secrets
Summary: 0 blocking, 0 needs-action, 0 optional, 0 fixed.
```

If you see `[OPT] Ollama: error sending request`, Ollama isn't running — see Step 1. If you see `[BLOCK] Agent dir not found`, your `~/.aeqi/` got corrupted; run `aeqi setup --force` to re-seed.

## Step 5 — Run

```bash
aeqi start
```

aeqi prints its readiness summary, then probes itself: when both the daemon socket and the web bind respond, it prints `Ready: daemon + web up — open http://...`. If you get `ERROR: neither daemon nor web responded within 10s`, scroll up — the underlying error is in the lines immediately above.

## Step 6 — Chat

Open the dashboard URL printed by `aeqi start` (default `http://localhost:8400`). Paste the secret printed by `aeqi setup`. You're in.

In a second terminal you can also use the TUI:

```bash
aeqi chat
```

Type a question. The assistant agent dispatches to the model you configured, streams the response back, and persists the transcript in `~/.aeqi/sessions.db`. No request leaves your machine.

## Step 7 — Run a useful first quest

Quests are durable units of work. Start with a small operator artifact that
captures what you just set up:

```bash
aeqi assign "Create a concise first-run checklist for this AEQI runtime: include where setup wrote config, which provider/runtime is configured, how to reopen the dashboard, and the next verification command to run." --root assistant
```

The assistant agent picks it up, runs the local model, and stores the result.
Watch progress live:

```bash
aeqi monitor --watch
```

## What you've got now

- Your starter agent is in `~/.aeqi/aeqi.db`.
- Every chat / quest / event lives in `~/.aeqi/sessions.db` and `~/.aeqi/aeqi.db`.
- Your first quest result is now a reusable note for reopening and verifying
  this runtime.
- Nothing has called an external API. You can `curl` your Ollama at `http://localhost:11434` to confirm it's the only thing handling inference.

## Where to next

- Add a real project: edit `~/.aeqi/aeqi.toml` and add a `[[projects]]` block pointing at a git repo. Run `aeqi assign "<task>" --root <project-name>` and the agent gets its own worktree.
- Swap in a paid provider when you're ready: `aeqi secrets set OPENROUTER_API_KEY <key>`, change `default_runtime = "openrouter_agent"` in the config, restart.
- Read [architecture.md](architecture.md) for how the runtime actually works under the hood.
