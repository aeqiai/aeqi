# AEQI Web Dashboard

Frontend for the AEQI agent runtime. Vite + React 19 + Zustand + TypeScript.

## Stack

- **Build:** Vite 6, React 19, TypeScript 5
- **State:** Zustand (auth store, daemon store, chat store, ui store)
- **Routing:** React Router v7
- **Styling:** CSS custom properties in `src/styles/primitives.css` (light zinc palette, JetBrains Mono + Inter)
- **API:** `src/lib/api.ts` -- fetch wrapper with JWT auth, auto-redirect on 401

## Layout

Two-column layout: AgentTree sidebar (left, 240px) + content area with floating nav bar (search via Cmd+K, page links). Content renders in `<Outlet />` inside the content panel.

## Primitives

The UI is built around four primitives:
- **Agent** -- autonomous entities with parent-child hierarchy
- **Quest** -- work items (formerly "tasks")
- **Event** -- audit/activity stream
- **Insight** -- agent knowledge and memories

## Pages

| Page | Path | What it does |
|------|------|-------------|
| Dashboard | `/` | Stats, active quests, activity feed |
| Quests | `/quests` | Quest list, filter by status/agent |
| Sessions | `/sessions` | Split pane: session list + transcript. WebSocket chat with agents |
| Events | `/events` | Event stream (audit trail) |
| Insights | `/insights` | Agent knowledge/memory search |
| Agent Detail | `/agents/:name` | Agent identity, files, activity |
| Settings | `/settings` | Daemon connection, logout |
| Login | `/login` | JWT authentication |

Legacy paths redirect to their current equivalents.

## State Stores

| Store | File | Purpose |
|-------|------|---------|
| auth | `src/store/auth.ts` | JWT token, login/logout |
| daemon | `src/store/daemon.ts` | Agents, quests, events, cost, status |
| chat | `src/store/chat.ts` | Selected agent, per-agent thread state |
| ui | `src/store/ui.ts` | UI preferences (sidebar, layout) |

## Deployment

```bash
cd apps/ui
npm run build
```

- Build outputs to `apps/ui/dist`
- Set `[web].ui_dist_dir` in `aeqi.toml`
- Run `aeqi web start`

## Dev

```bash
npm run dev  # Vite dev server on :5173, proxies /api to :8400
```
