---
name: meta:pack:wecom
tags: [meta, pack-infrastructure, integration]
description: Planned WeCom / Enterprise WeChat messaging integration. Company-grade first target is callback mode for self-built enterprise apps; personal Weixin comes later as a user-scoped device-session channel.
---

# pack:wecom

Status: planned, not callable yet.

AEQI's first WeChat-family integration should be **WeCom Callback** for
company use, not personal Weixin. WeCom Callback maps naturally to AEQI's
COMPANY model: a company registers a self-built enterprise app, WeCom calls
AEQI's public callback endpoint, AEQI verifies/decrypts the message, queues
agent work, and sends the reply proactively through WeCom's `message/send`
API.

## Target mode

Recommended first mode: `callback_self_built_app`

Why this first:

- It is enterprise/company-native.
- It can appear as a first-class app inside WeCom.
- It supports multi-corp routing.
- It does not require a long-running WebSocket adapter per company.
- It matches AEQI's platform control plane, public routes, credential store,
  role grants, and async agent sessions.

Hermes also supports a WeCom WebSocket bot mode. That is useful for group-bot
style deployments, but AEQI should start with callback mode because the product
story is "your company has an app/channel," not "your laptop runs a bot."

## Credential model

Credential scope:

```
provider:        "wecom"
scope_kind:      "company"
scope_id:        "<company/entity id>"
lifecycle_kind:  "service_account_callback"
```

Credential fields:

- `corp_id`
- `corp_secret`
- `agent_id`
- `token`
- `encoding_aes_key`
- optional `app_name`

Runtime metadata:

- public callback path
- corp/app routing key
- access token cache expiry
- inbound message dedupe window
- allowed role grants

## Callback flow

1. User creates a WeCom self-built app in the WeCom admin console.
2. AEQI shows the company-specific callback URL.
3. WeCom sends a GET verification request with signature/timestamp/nonce.
4. AEQI verifies and decrypts `echostr`, then returns plaintext.
5. WeCom POSTs encrypted XML messages to the same endpoint.
6. AEQI verifies signature and decrypts the payload.
7. AEQI deduplicates retries by message id.
8. AEQI maps `corp_id:user_id` to a channel/user identity.
9. AEQI immediately returns `success`.
10. AEQI queues an agent session asynchronously.
11. AEQI sends the eventual reply via WeCom `message/send`.

The immediate ACK matters: WeCom retries callbacks when the endpoint is slow.
Agent work can take seconds or minutes, so replies must be proactive outbound
messages instead of synchronous HTTP responses.

## Access model

Use both platform policy and AEQI authority:

- COMPANY role/app grants: `apps.wecom.use`, later narrower grants like
  `apps.wecom.send.use`.
- Channel allowlists for permitted WeCom users/groups.
- Per-group sender allowlists for group workflows.
- Audit every inbound message and outbound reply against the company/session.

Do not let raw possession of the callback URL imply authority.

## Capability target

V1:

- direct messages
- text outbound
- encrypted callback verification/decryption
- proactive send
- multi-corp routing
- dedupe
- company-scoped credentials
- role/app grants

V1.5:

- group messages
- media download/upload
- file attachments
- typing/status affordance where supported
- richer markdown rendering

Later:

- WebSocket bot mode
- personal Weixin QR/iLink adapter

## Weixin caution

Personal Weixin is a separate integration. Hermes' iLink approach uses QR login,
long-polling, context tokens, and a bot identity. Ordinary WeChat group delivery
can be unreliable or unavailable for many account types. AEQI should not promise
personal WeChat group workflows until a real account proves event delivery.

Personal Weixin should therefore be user-scoped (`ScopeHint::User` or
device-session), while WeCom is company-scoped.

## Acceptance for the real pack

- `apps.planned provider=wecom` describes this integration before launch.
- `apps.catalog provider=wecom` stays empty until real tools exist.
- Platform callback route verifies WeCom URL handshake.
- POST callback decrypts XML using a test vector and deduplicates retries.
- Inbound message creates or resumes an AEQI session.
- Outbound reply calls `message/send` with cached access-token refresh.
- Role/app grants are enforced before agent processing or outbound send.
