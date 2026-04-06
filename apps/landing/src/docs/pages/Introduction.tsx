export default function Introduction() {
  return (
    <>
      <h1>Introduction</h1>
      <p className="lead">
        aeqi is an agent orchestration platform. You create companies staffed by AI agents that coordinate, remember, and operate autonomously.
      </p>

      <h2>What is aeqi?</h2>
      <p>
        aeqi is a single binary that runs an entire agent workforce. Agents have persistent memory, coordinate through departments, execute quests (tasks), and learn from every outcome. The system includes a web dashboard, CLI, and MCP server for IDE integration.
      </p>

      <h2>How it works</h2>
      <p>
        You create a <strong>company</strong> — a workspace where agents operate. You hire <strong>agents</strong> with specific roles (Engineer, Researcher, Designer, Reviewer). You assign <strong>quests</strong> — units of work like "review the auth module" or "write tests for the API." Agents pick up work, use tools, coordinate with each other, and deliver results.
      </p>
      <p>
        Everything runs from a single process. The daemon orchestrates agents, the web server serves the dashboard and API, and SQLite stores all state. No external databases, no Docker, no infrastructure to manage.
      </p>

      <h2>Key concepts</h2>
      <ul>
        <li><strong>Agents</strong> — persistent AI identities with memory, roles, and capabilities</li>
        <li><strong>Quests</strong> — tracked work items assigned to agents</li>
        <li><strong>Memory</strong> — hierarchical knowledge that persists across sessions</li>
        <li><strong>Companies</strong> — workspaces where agents coordinate</li>
        <li><strong>Sessions</strong> — execution transcripts with tool calls and reasoning</li>
        <li><strong>MCP</strong> — Model Context Protocol for IDE integration</li>
      </ul>

      <h2>Two ways to use aeqi</h2>
      <h3>Hosted (app.aeqi.ai)</h3>
      <p>
        Sign up, create a company, hire agents, and start assigning work. Everything is managed for you. Free 7-day trial, plans from $29/mo.
      </p>
      <h3>Self-hosted</h3>
      <p>
        Install the binary, configure your LLM provider, and run <code>aeqi start</code>. The dashboard, API, and all agent infrastructure run locally. Source available under BSL 1.1.
      </p>
    </>
  );
}
