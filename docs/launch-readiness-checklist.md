# MVP Launch Readiness Checklist

Quest root: `ch-134`

This checklist is the supervisor state for the launch sprint. A page or system
is launch-ready only when it has a named owner, a verified route, desktop and
mobile screenshots, and a clear rollback path.

## Current Status

| Area                    | Quest      | Status        | Gate                                                                 |
| ----------------------- | ---------- | ------------- | -------------------------------------------------------------------- |
| Company canonical page    | `ch-134` | Passed prod smoke | Typecheck, build, desktop/mobile screenshots, production route smoke |
| Canonical pages sweep   | `ch-134` | Passed prod smoke | Home, Economy, Blueprints, Company share the same primitive shell      |
| Economy and cap table   | `ch-137` | Proved locally     | Fresh COMPANY seeds 80/20 allocation rows; production routes deployed |
| Session streaming       | `ch-134` | Covered by tests   | First message, live processing, and final answer render consistently |
| Views dashboard         | `ch-136` | Durable v0 shipped | Typed widget registry, tabbed views, public/private scope            |
| First-user launch flow  | `ch-134` | Passed prod smoke  | Signup/login to launch route and first launch surface render cleanly |
| Visual QA and ship gate | `ch-138` | Passed prod smoke  | Screenshots and checks pass after production deploy                  |

## Canonical Pages

- `/company`: production smoke passed for the canonical COMPANY overview.
- `/`: production smoke passed for the global marketing/referral surface.
- `/economy`: production smoke passed on desktop and mobile. Existing production
  Companies may show no seed rows when they predate the seed path; fresh local COMPANY
  creation proved the intended 80/20 rows.
- `/blueprints`: production smoke passed. v1 exposes First Company as the
  launchable company package and keeps draft Foundation/Fund lanes honest.
- `/launch`: production smoke passed. The flow makes free, paid, and admin paths
  explicit.

## Functional Launch Gates

- Sessions: preserve initial system/autonomous messages, stream or poll live
  work after send, and avoid awkward thinking/final collapse.
- Views: durable v0 is implemented for company-scoped views. Public overview must
  continue to filter private widgets.
- Economy: cap-table seed defaults are implemented for fresh Companies. Existing
  Companies may remain empty until backfilled or relaunched, so Economy copy must
  keep distinguishing intended seed rows from on-chain balances.
- Agents/tools: MCP view tools are implemented; economy/cap-table mutation tools
  should remain rights-gated before broader user exposure.

## Verification Matrix

Run before ship:

- `npm --prefix apps/ui run typecheck`
- `npm --prefix apps/ui run format:check`
- `npm --prefix apps/ui run design-system:audit`
- `npm --prefix apps/ui run build`
- `cargo test -p aeqi-orchestrator --test cap_table_defaults`
- `cargo test -p aeqi-orchestrator --test entity_views`
- `cargo test -p aeqi-web`
- `cargo build --release -p aeqi`
- `AEQI_ENTITY=C68sd4DX6K7aSLaTyfPnAw7cqN5Fj82qX7JyuDj8NVY4 node scripts/launch-smoke.mjs --base https://app.aeqi.ai --company C68sd4DX6K7aSLaTyfPnAw7cqN5Fj82qX7JyuDj8NVY4 --out-dir screenshots/ch-139/prod-smoke-final --wait-ms 3500`

## Known Blockers

- No current production smoke blocker.
- Existing production Companies created before the cap-table seed change return
  `entries: []`; proving production 80/20 rows requires creating a new
  production COMPANY, which has user-visible side effects.
- This branch remains dirty until the ship cycle stages source/test/docs and
  leaves screenshot evidence uncommitted or explicitly archived.
