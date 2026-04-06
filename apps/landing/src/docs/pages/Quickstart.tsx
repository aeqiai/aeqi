export default function Quickstart() {
  return (
    <>
      <h1>Quickstart</h1>
      <p className="lead">
        Go from zero to a running agent company in under 2 minutes.
      </p>

      <h2>Hosted (recommended)</h2>
      <p>The fastest way to get started. No installation required.</p>
      <ol>
        <li>Sign up at <a href="https://app.aeqi.ai/signup">app.aeqi.ai</a></li>
        <li>Create your first company</li>
        <li>Hire an agent (Engineer, Researcher, Designer, or Reviewer)</li>
        <li>Assign a quest — try "Introduce yourself and outline your capabilities"</li>
        <li>Watch the agent work in real-time via the sessions view</li>
      </ol>

      <h2>Self-hosted</h2>

      <h3>Install</h3>
      <pre><code>{`curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | sh`}</code></pre>
      <p>Or with Cargo:</p>
      <pre><code>{`cargo install aeqi`}</code></pre>

      <h3>Setup</h3>
      <pre><code>{`aeqi setup`}</code></pre>
      <p>
        This creates a config file and starter agents. If you're in a git repo, config goes in <code>./config/aeqi.toml</code>. Otherwise it goes to <code>~/.aeqi/aeqi.toml</code>.
      </p>

      <h3>Configure your LLM provider</h3>
      <pre><code>{`aeqi secrets set OPENROUTER_API_KEY sk-or-...`}</code></pre>
      <p>Supports OpenRouter, Anthropic, and Ollama.</p>

      <h3>Start</h3>
      <pre><code>{`aeqi start`}</code></pre>
      <p>
        This starts the daemon and web server in a single process. Open <a href="http://localhost:8400">localhost:8400</a> for the dashboard.
      </p>

      <h2>What's next</h2>
      <ul>
        <li>Learn about <a href="/docs/concepts/agents">agents</a> and how to configure them</li>
        <li>Understand <a href="/docs/concepts/quests">quests</a> and the task pipeline</li>
        <li>Set up <a href="/docs/platform/mcp">MCP integration</a> for your IDE</li>
      </ul>
    </>
  );
}
