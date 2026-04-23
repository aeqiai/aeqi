# WhatsApp + Telegram: reply & react tools

Design doc for the four new LLM-callable messaging tools that enable richer
responses on WhatsApp and Telegram: quoted replies and emoji reactions.

## Current state

### Baileys send path

`bridges/baileys/src/bridge.mjs` exposes one outbound method today:
`send_text({jid, text})` (line 192–200), which calls `sock.sendMessage(jid, { text })`.
No reply-quoting or reaction payload is wired. The bridge protocol is JSON-lines
over stdio; the Rust side calls it via `BridgeClient.call()`
(`crates/aeqi-gates/src/bridge.rs:145`).

`WhatsAppBaileysChannel::send()` (`crates/aeqi-gates/src/whatsapp_baileys.rs:384–398`)
calls `bridge.call("send_text", json!({...}))`. No other outbound bridge methods exist.

**Inbound message event** emitted at `bridge.mjs:160–170`:

```js
{ id, jid, from_me, self_chat, is_group, participant, push_name, text, timestamp }
```

`id` = `msg.key.id`. `jid` = normalised `msg.key.remoteJid`. `participant` =
normalised `msg.key.participant` (set in group chats). `from_me` = `msg.key.fromMe`.

The full Baileys `msg.key` needed for `{ quoted: msg }` is:
`{ id, remoteJid, fromMe, participant }` — all four fields are available in the
bridge event.

### Rust-side inbound capture (WhatsApp)

In `aeqi-cli/src/cmd/channel_gateways/whatsapp_baileys.rs:188–197`, when an inbound
message arrives the gateway calls
`session_store.record_message(session_id, sender_id, "whatsapp-baileys", "user", text, Some(&json!({"jid": jid})))`.
The metadata stored is only `{"jid": jid}` — **the inbound message `id`
(needed to reconstruct `msg.key`) is not persisted**.

### Telegram send path

`TelegramChannel::send()` (`crates/aeqi-gates/src/telegram.rs:230–275`) posts to
`sendMessage` with `chat_id` + `text`. No `reply_to_message_id` is wired.

`TelegramChannel::react()` (`crates/aeqi-gates/src/telegram.rs:280–301`) already
exists and calls `setMessageReaction`. It is already implemented at the
`Channel` trait level (`crates/aeqi-core/src/traits/channel.rs:32–36`).

### Telegram inbound capture

In `aeqi-cli/src/cmd/channel_gateways/telegram.rs:204–214`, `record_message` stores
metadata `{"chat_id": ..., "message_id": ...}`. **Both fields are already persisted**
for every inbound telegram message.

### Tool plumbing

Tools implement `aeqi_core::traits::Tool` (`crates/aeqi-core/src/traits/tool.rs:83`):
three methods — `execute(args: serde_json::Value)`, `spec() -> ToolSpec`,
`name() -> &str`. Registration happens by pushing an `Arc<dyn Tool>` into a `Vec`
passed to `ToolRegistry::new()` (`crates/aeqi-core/src/tool_registry.rs:126`).
Runtime tools live in `crates/aeqi-orchestrator/src/runtime_tools/`; LLM-facing
general tools live in `crates/aeqi-tools/src/`.

Channel-specific tools (reply/react) must reach a live channel object, so they
need to live close to the gateway — new modules in `crates/aeqi-tools/` that
accept `Arc<dyn Channel>` (or concrete channel) at construction time.

There is **no existing `whatsapp_send` tool**. Current send is done entirely via
the `SessionGateway::deliver_response` path — the LLM never calls a send tool.
The four new tools would be the first LLM-callable messaging tools.

## Gap analysis

| Gap | WhatsApp | Telegram |
|-----|----------|----------|
| Bridge method for quoted reply | Missing — need `send_reply` in `bridge.mjs` | N/A — pure HTTP param |
| Bridge method for reaction | Missing — need `send_reaction` in `bridge.mjs` | N/A — `TelegramChannel::react()` exists |
| Inbound message_id persisted | No — `record_message` only stores `{"jid": jid}` | Yes — `{"chat_id":..., "message_id":...}` already stored |
| Rust-side send_reply method on channel | Missing from `WhatsAppBaileysChannel` | Missing `reply_to_message_id` param on `TelegramChannel::send` |
| Rust-side react method on channel | Missing from `WhatsAppBaileysChannel` | Exists: `TelegramChannel::react(chat_id, message_id, emoji)` |
| LLM-callable tool | None | None |

## Design

### Tool: `whatsapp_reply`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "jid":              { "type": "string", "description": "WhatsApp JID of the conversation (e.g. 15551234567@s.whatsapp.net)" },
    "text":             { "type": "string", "description": "Reply text to send" },
    "reply_to_id":      { "type": "string", "description": "The WhatsApp message id (msg.key.id) to quote" },
    "reply_to_from_me": { "type": "boolean", "description": "true if the quoted message was sent by us" },
    "participant":      { "type": "string", "description": "Group participant JID if the quoted message is in a group, else omit" }
  },
  "required": ["jid", "text", "reply_to_id"]
}
```

**Output**: `{ "id": "<new msg id>", "jid": "..." }` on success.

**Handler location**: new file `crates/aeqi-tools/src/whatsapp.rs`. Struct
`WhatsAppReplyTool { channel: Arc<WhatsAppBaileysChannel> }`. Registered in the
tool vec built per-session when the session is on a whatsapp-baileys channel.

**Gateway path**:

1. Tool calls `channel.send_reply(jid, text, quoted_key)` — a new method added to `WhatsAppBaileysChannel`.
2. `send_reply` calls `bridge.call("send_reply", json!({ "jid": jid, "text": text, "quoted_id": id, "quoted_remote_jid": jid, "quoted_from_me": false, "participant": null }))`.
3. Bridge handler calls `sock.sendMessage(jid, { text }, { quoted: reconstructedMsg })`.

**Bridge change** (`bridges/baileys/src/bridge.mjs`, new `case "send_reply"` in `handle()`):

```js
case "send_reply": {
  if (!sock) throw new Error("send_reply: socket not started");
  const { jid, text, quoted_id, quoted_remote_jid, quoted_from_me, participant } = params ?? {};
  // Baileys needs a minimal proto message with key to thread the reply
  const quoted = {
    key: {
      id: quoted_id,
      remoteJid: quoted_remote_jid ?? jid,
      fromMe: !!quoted_from_me,
      ...(participant ? { participant } : {}),
    },
    message: { conversation: "" }, // content doesn't matter for quoting
  };
  const res = await sock.sendMessage(jid, { text }, { quoted });
  rememberSent(res?.key?.id);
  return { id: res?.key?.id ?? null, jid };
}
```

**Required metadata from inbound messages**: `msg.key.id`, `msg.key.remoteJid`
(already = `jid` in the event), `msg.key.fromMe`, `msg.key.participant`. The
bridge event already emits `id`, `jid`, `from_me`, and `participant`
(line 161–167 of `bridge.mjs`). The Rust side in
`aeqi-cli/src/cmd/channel_gateways/whatsapp_baileys.rs:195` must store all four
in `record_message` metadata.

### Tool: `whatsapp_react`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "jid":         { "type": "string" },
    "message_id":  { "type": "string", "description": "msg.key.id of the message to react to" },
    "emoji":       { "type": "string", "description": "Single emoji, e.g. \"👍\"" },
    "from_me":     { "type": "boolean" },
    "participant": { "type": "string" }
  },
  "required": ["jid", "message_id", "emoji"]
}
```

**Handler location**: same `crates/aeqi-tools/src/whatsapp.rs`. Struct
`WhatsAppReactTool { channel: Arc<WhatsAppBaileysChannel> }`.

**Gateway path**:

1. Tool calls `channel.send_reaction(jid, message_id, emoji, from_me, participant)`.
2. `send_reaction` calls `bridge.call("send_reaction", {...})`.
3. Bridge calls `sock.sendMessage(jid, { react: { text: emoji, key: { id, remoteJid: jid, fromMe, participant } } })`.

**Bridge change** (`bridge.mjs`, new `case "send_reaction"`):

```js
case "send_reaction": {
  if (!sock) throw new Error("send_reaction: socket not started");
  const { jid, message_id, emoji, from_me, participant } = params ?? {};
  const res = await sock.sendMessage(jid, {
    react: {
      text: emoji,
      key: {
        id: message_id,
        remoteJid: jid,
        fromMe: !!from_me,
        ...(participant ? { participant } : {}),
      },
    },
  });
  rememberSent(res?.key?.id);
  return { reacted: true, jid, message_id };
}
```

### Tool: `telegram_reply`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "chat_id":             { "type": "integer" },
    "text":                { "type": "string" },
    "reply_to_message_id": { "type": "integer", "description": "message_id of the message to quote" }
  },
  "required": ["chat_id", "text", "reply_to_message_id"]
}
```

**Handler location**: new file `crates/aeqi-tools/src/telegram.rs`. Struct
`TelegramReplyTool { channel: Arc<TelegramChannel> }`.

**Gateway path**: Call a new `TelegramChannel::send_reply(chat_id, text, reply_to_message_id)`
method. This posts to `sendMessage` with an additional
`reply_parameters: { "message_id": reply_to_message_id }` field (Bot API 7.0+ syntax;
`reply_to_message_id` top-level still works for backwards compat).

**Change to `crates/aeqi-gates/src/telegram.rs`**: add a `SendReply` struct or extend `SendMessage`:

```rust
#[derive(Serialize)]
struct SendMessageWithReply {
    chat_id: i64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parse_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to_message_id: Option<i64>,
}
```

Add `pub async fn send_reply(&self, chat_id: i64, text: String, reply_to: i64) -> Result<()>`
method to `TelegramChannel` (around line 230, parallel to `send()`).

**Required metadata**: `chat_id` + `message_id` — already stored in `record_message`
metadata for every inbound Telegram message
(`aeqi-cli/src/cmd/channel_gateways/telegram.rs:210`). No schema change needed.

### Tool: `telegram_react`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "chat_id":    { "type": "integer" },
    "message_id": { "type": "integer" },
    "emoji":      { "type": "string", "description": "Single emoji" }
  },
  "required": ["chat_id", "message_id", "emoji"]
}
```

**Handler location**: same `crates/aeqi-tools/src/telegram.rs`. Struct
`TelegramReactTool { channel: Arc<TelegramChannel> }`.

**Gateway path**: `TelegramChannel::react(chat_id, message_id, emoji)` already
exists at `crates/aeqi-gates/src/telegram.rs:280`. The tool just calls it. No
new gateway method needed.

## Schema changes needed

### WhatsApp: `session_messages.metadata` must include message key fields

**Current state** (`aeqi-cli/src/cmd/channel_gateways/whatsapp_baileys.rs:195`):

```rust
Some(&serde_json::json!({"jid": jid}))
```

**Required state** (to enable reply and react):

```rust
Some(&serde_json::json!({
    "jid": jid,
    "message_id": msg.metadata["id"].as_str().unwrap_or(""),
    "from_me": msg.metadata["from_me"].as_bool().unwrap_or(false),
    "participant": msg.metadata.get("participant").and_then(|v| v.as_str()),
}))
```

Where `msg` is the `IncomingMessage` whose `.metadata` is the full `ev.data`
clone from `whatsapp_baileys.rs:300–305` (`metadata: ev.data.clone()`). The
`ev.data` already contains `id`, `from_me`, `participant` — they just need to
be propagated into the `record_message` call.

This is **not a DB schema change** (the `metadata` column already exists as
`TEXT DEFAULT NULL`). It is a change to what JSON is stored in that column. No
SQLite migration is required.

### Telegram: no change

`chat_id` and `message_id` are already stored in every inbound message's metadata
row (`telegram.rs:210`).

## Implementation order

1. **Bridge: add `send_reply` and `send_reaction` methods** to
   `bridges/baileys/src/bridge.mjs` (new `case` blocks in `handle()`). Update
   the comment block at the top listing Methods. Add integration test covering
   both methods against a mocked sock (or skip if sock not present, as the
   existing ping test does).

2. **WhatsApp Rust channel: expose `send_reply` and `send_reaction`** on
   `WhatsAppBaileysChannel` (`crates/aeqi-gates/src/whatsapp_baileys.rs`). These
   call `self.bridge.call(...)` with the new method names.

3. **Metadata fix in channel gateway**: in
   `aeqi-cli/src/cmd/channel_gateways/whatsapp_baileys.rs:195`, extend the
   `record_message` metadata JSON to include `message_id`, `from_me`,
   `participant` from `msg.metadata`.

4. **Telegram: add `send_reply` method** to `TelegramChannel`
   (`crates/aeqi-gates/src/telegram.rs`, after line 275). Uses `reply_to_message_id`
   field in the `sendMessage` payload.

5. **Tool implementations**: create `crates/aeqi-tools/src/whatsapp.rs` with
   `WhatsAppReplyTool` and `WhatsAppReactTool`; create
   `crates/aeqi-tools/src/telegram.rs` with `TelegramReplyTool` and `TelegramReactTool`.
   Each implements `Tool` with `is_destructive() = true`, `is_concurrent_safe() = false`.

6. **Export from `crates/aeqi-tools/src/lib.rs`**: add
   `pub mod whatsapp; pub mod telegram;` and re-export all four tools.

7. **Wire into per-session tool registry**: in
   `aeqi-cli/src/cmd/channel_gateways/whatsapp_baileys.rs` and `telegram.rs`,
   after the channel is live, construct the relevant tool structs with an `Arc`
   clone of the channel and add them to the tool vec that the `QueueExecutor` /
   `SessionManager` receives. The exact injection point is wherever
   `build_runtime_registry` or the agent tool list is assembled for those
   sessions — trace through `QueueExecutor` → `SessionManager::spawn_session`
   to find where the `Vec<Arc<dyn Tool>>` for the session is built.

8. **Tests**: unit tests for each `Tool::execute` using a mock channel;
   integration test (feature-flagged) calling `whatsapp_reply` end-to-end
   against a live QR-paired session.
