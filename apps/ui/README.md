# AEQI UI

Web dashboard for the AEQI agent runtime. React 19, Vite 6, TypeScript, Zustand.

In production the UI is embedded directly into the `aeqi` Rust binary via `rust-embed` at compile time. No Node.js required to run the dashboard -- it ships inside the binary.

## Dev Workflow

Use Node.js 22 or newer. The repo root includes `.nvmrc`.

Start the Vite dev server with hot reload:

```bash
cd apps/ui
npm install
npm run dev        # :5173, proxies /api to :8400
```

The `aeqi` daemon must be running on port 8400 for API calls to work.
For visual QA against the hosted app data without browser CORS failures, keep
the client on same-origin `/api` and let Vite proxy to production:

```bash
npm run dev:prod-api
```

You can target another backend with `AEQI_UI_API_PROXY_TARGET`, for example:

```bash
AEQI_UI_API_PROXY_TARGET=https://staging.example.com npm run dev
```

To use the dev build instead of the embedded UI, set an optional override in `aeqi.toml`:

```toml
[web]
ui_dist_dir = "apps/ui/dist"
```

This tells the daemon to serve files from disk rather than the compiled-in assets.

## Build

```bash
npm run build      # typecheck + vite build -> apps/ui/dist
npm run verify     # typecheck + prettier + eslint + tests + hygiene + build
```

The CI embeds `dist/` into the Rust binary. You only need to build manually when testing the production bundle locally.

## Styling

All design tokens live in `src/styles/primitives.css` as CSS custom properties:

- **Palette:** light zinc (white base, zinc-50 surfaces, zinc-200 borders)
- **Typography:** Inter for UI text, system mono via `var(--font-mono)` for code
- **No CSS framework** -- plain CSS files per component/page in `src/styles/`

## Design-System Gates

```bash
npm run hygiene
npm run design-system:audit
npm run verify
```

`design-system:audit` is a ratchet for future Claude/Codex/human work. It
records today's legacy drift in `scripts/design-system-baseline.json` and fails
when a change adds more raw controls, inline style objects, literal colors,
gradients, backdrop blur, border-left stripes, SPA-breaking navigation, or
exported primitives without Storybook stories. Use primitives first; lower the
baseline when a migration removes debt.

## Stack

| Layer     | Choice                                         |
| --------- | ---------------------------------------------- |
| Framework | React 19                                       |
| Build     | Vite 6                                         |
| Language  | TypeScript 5                                   |
| State     | Zustand 5 (auth, daemon, chat, ui stores)      |
| Routing   | React Router 7                                 |
| API       | Fetch wrapper with JWT auth (`src/lib/api.ts`) |

## Pages

| Page         | Path                              | Description                                                            |
| ------------ | --------------------------------- | ---------------------------------------------------------------------- |
| Company Home | `/:companyId`                     | Company-scoped inbox and execution surface                             |
| Quests       | `/:companyId/quests`              | Linear-style grouped list, filterable by status and agent              |
| Sessions     | `/:companyId/sessions/:sessionId` | Chat history and live transcript with the selected agent via WebSocket |
| Events       | `/:companyId/events`              | Audit/activity event stream                                            |
| Ideas        | `/:companyId/ideas`               | Company knowledge and idea search                                      |
| Agents       | `/:companyId/agents`              | Company org chart and agent hierarchy                                  |
| Account      | `/account`                        | User profile and account settings                                      |
| Login        | `/login`                          | JWT authentication                                                     |

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
