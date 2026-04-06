# AEQI UI

Web dashboard for the AEQI agent runtime. React 19, Vite 6, TypeScript, Zustand.

In production the UI is embedded directly into the `aeqi` Rust binary via `rust-embed` at compile time. No Node.js required to run the dashboard -- it ships inside the binary.

## Dev Workflow

Start the Vite dev server with hot reload:

```bash
cd apps/ui
npm install
npm run dev        # :5173, proxies /api to :8400
```

The `aeqi` daemon must be running on port 8400 for API calls to work.

To use the dev build instead of the embedded UI, set an optional override in `aeqi.toml`:

```toml
[web]
ui_dist_dir = "apps/ui/dist"
```

This tells the daemon to serve files from disk rather than the compiled-in assets.

## Build

```bash
npm run build      # tsc + vite build -> apps/ui/dist
```

The CI embeds `dist/` into the Rust binary. You only need to build manually when testing the production bundle locally.

## Styling

All design tokens live in `src/styles/primitives.css` as CSS custom properties:

- **Palette:** light zinc (white base, zinc-50 surfaces, zinc-200 borders)
- **Typography:** Inter for UI text, JetBrains Mono for code
- **No CSS framework** -- plain CSS files per component/page in `src/styles/`

## Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 |
| Build | Vite 6 |
| Language | TypeScript 5 |
| State | Zustand 5 (auth, daemon, chat, ui stores) |
| Routing | React Router 7 |
| API | Fetch wrapper with JWT auth (`src/lib/api.ts`) |

## Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Stats, active quests, activity feed |
| Quests | `/quests` | Linear-style grouped list, filterable by status and agent |
| Sessions | `/sessions` | Split pane: session list + transcript, WebSocket chat |
| Events | `/events` | Audit/activity event stream |
| Insights | `/insights` | Agent knowledge and memory search |
| Agent Detail | `/agents/:name` | Identity, files, activity |
| Settings | `/settings` | Daemon connection, logout |
| Login | `/login` | JWT authentication |

## Project Structure

```
src/
  components/    # Shared components
  hooks/         # Custom React hooks
  lib/           # API client, utilities
  pages/         # Route-level page components
  store/         # Zustand stores (auth, daemon, chat, ui)
  styles/        # CSS files (primitives.css + per-page/component sheets)
  App.tsx        # Router + layout shell
  main.tsx       # Entry point
```
