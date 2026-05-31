---
name: meta:pack:etsy
tags: [meta, pack-infrastructure, integration]
description: Native Etsy seller tools. Company-scoped OAuth for one company storefront, with read tools for shops/listings/orders and a draft-only listing creation workflow for human review.
---

# pack:etsy

Crate: `aeqi-pack-etsy`
Feature: `aeqi-orchestrator` default dependency
Branch: `feat/etsy-integration-mvp`

## What's in the pack

Five native tools, all COMPANY-scoped (`ScopeHint::Company`):

- `etsy_shops_list` — list shops owned by the connected Etsy user.
- `etsy_shop_get(shop_id)` — fetch one shop by id.
- `etsy_listings_list(shop_id, state?, limit?, offset?)` — list shop
  listings. `state` defaults to `active`; pagination is explicit.
- `etsy_orders_list(shop_id, limit?, offset?)` — list recent shop receipts
  and order data for operational review.
- `etsy_draft_listing_create(shop_id, title, description, price,
  quantity, taxonomy_id, who_made, when_made, is_supply?, should_auto_renew?)`
  — create a draft listing only. Publishing stays outside V1 so agents can
  prepare commerce work without silently exposing products to buyers.

## OAuth scopes

Each tool declares the narrowest Etsy scope it needs:

| Tool | Scope(s) |
|---|---|
| `etsy_shops_list` | `shops_r` |
| `etsy_shop_get` | `shops_r` |
| `etsy_listings_list` | `listings_r` |
| `etsy_orders_list` | `transactions_r` |
| `etsy_draft_listing_create` | `listings_w` |

The platform OAuth route requests the union for the company app:
`shops_r`, `listings_r`, `listings_w`, `transactions_r`.

## COMPANY scoping

Etsy is a company storefront, not an individual inbox. Credentials should
be stored as:

```
provider:        "etsy"
name:            "oauth_token"
scope_kind:      "company"
scope_id:        "<company/entity id>"
lifecycle_kind:  "oauth2"
```

Humans and agents receive access through COMPANY role/app grants such as
`apps.use`, `apps.etsy.use`, or a narrower tool grant. The runtime uses the
credential resolver to serve every permitted role from the same seller
connection.

## Lifecycle — oauth2

The platform owns the Etsy OAuth client and callback. A successful connect
stores:

- access token / refresh token in the encrypted credential blob,
- `provider_kind = "etsy"`,
- `api_base = "https://api.etsy.com/v3/application"`,
- `client_id`,
- `api_secret`,
- `api_key` for Etsy's `x-api-key` header,
- requested scopes and `expires_at`.

Important: Etsy's public API requires both `Authorization: Bearer <token>`
and `x-api-key`. The pack reads the bearer from the OAuth row and the API key
from credential metadata.

Refresh-on-401 follows the framework convention: tools surface
`reason_code=auth_expired` with `credential_id`; `ToolRegistry::invoke`
refreshes once and retries.

## Setup

1. Create an Etsy app in the Etsy developer console.
2. Configure the platform with `ETSY_CLIENT_ID` and `ETSY_CLIENT_SECRET`.
3. Wait for Etsy app approval if the key is pending review.
4. In AEQI, connect the Etsy app on the COMPANY Apps/Integrations surface.
5. Verify with `apps.catalog provider=etsy`, then call `etsy_shops_list`.

## Tests

Unit tests live in the pack crate and in the MCP route contract:

- `cargo test -p aeqi-pack-etsy`
- `cargo test -p aeqi-web routes::mcp::tests`

Coverage should include missing credentials, auth-expired markers,
read endpoints, draft listing payload shape, and catalog exposure.
