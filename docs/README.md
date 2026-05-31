# aeqi Docs

## Start here

- Existing hosted COMPANY: a COMPANY is the shared AI workspace and runtime for one
  mission. Install the CLI, set `AEQI_API_KEY`, and use `aeqi chat`; use
  [mcp-setup.md](mcp-setup.md) to connect Codex, Claude Code, editors, or
  other MCP clients to the same COMPANY runtime.
- [quickstart.md](quickstart.md) — install, set up, run the daemon/dashboard,
  and create a first useful quest.
- [self-hosting.md](self-hosting.md) — honest operator guide for running your own runtime.
- [local-demo.md](local-demo.md) — end-to-end walkthrough with no API key
  (uses local Ollama and keeps first-run state local unless you opt into
  `--workspace`).
- [onboarding-excellence-loop.md](onboarding-excellence-loop.md) — repeatable
  operator/contributor loop for improving setup paths with evidence.
- [vision.md](vision.md) — product north star and design principles.
- [primitive-contract.md](primitive-contract.md) — canonical COMPANY, roles,
  agents, quests, ideas, events, sessions, and apps/tools vocabulary.
- [product-contract.md](product-contract.md) — shared runtime vocabulary and UX rules.
- [agent-runtime-bar.md](agent-runtime-bar.md) — competitive product bar for
  first-run, memory, always-on execution, safety, and evidence.

## Operate

- [deployment.md](deployment.md) — production topology, systemd, reverse proxy.
- [runtime-platform-separation.md](runtime-platform-separation.md) — source-available runtime vs hosted platform.
- [mcp-setup.md](mcp-setup.md) — wire hosted or self-hosted aeqi into an MCP-aware client.
- [solana-company-handover.md](solana-company-handover.md) — current Solana company MVP state and next-step plan.

## Build with aeqi

- [architecture.md](architecture.md) — system map, crates, primitive contract, agent loop.
- [extension-plane.md](extension-plane.md) — runtime capability registry,
  typed event triggers, namespaces, and owner-token lifecycle.
- [operate-console.md](operate-console.md) — COMPANY-scoped observability spine
  for sessions, quests, events, tool calls, queues, and runtime health.
- [context-injection.md](context-injection.md) — how agent input context is assembled per quest.
- [agent-loop-parity.md](agent-loop-parity.md) — comparison with Claude Code's agent loop.
- [project-model.md](project-model.md) — canonical model for projects, repositories, library items, agents, and quests.
- [quest-evidence-contract.md](quest-evidence-contract.md) — evidence every meaningful quest should leave behind.
- [design/browser-capability-contract.md](design/browser-capability-contract.md) — native browser execution contract and backend posture.
- [ui-design.md](ui-design.md) — operator UI principles and information architecture.
- [repo-surface-catalog.json](repo-surface-catalog.json) — generated inventory
  of tracked repo surface for documentation and release drift checks.

## Roadmap

- [roadmap.md](roadmap.md) — current phases and what's next.
- [company-kernel-release.md](company-kernel-release.md) — release brief,
  demo contract, and first-pass gap audit for the Company Kernel release.

## Reference

- [design/](design/) — component design notes and architectural decisions.
- [security/](security/) — security configuration and hardening notes.
