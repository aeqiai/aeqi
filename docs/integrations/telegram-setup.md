# Telegram Integration Setup

Connect a Telegram bot to an aeqi company so agents can receive messages
from Telegram and reply in-chat.

## Architecture

```
Telegram Bot API
       |
       | HTTPS webhook POST
       v
https://app.aeqi.ai/api/webhooks/telegram/<token_hash>
       |
       | platform routes to runtime
       v
aeqi-host-<entity_id>.service
       |
       | IPC / SessionGateway
       v
Agent session (chat)
       |
       | outbound: TelegramReplyTool / TelegramReactTool
       v
Telegram Bot API (sendMessage / setMessageReaction)
```

The platform webhook handler (`aeqi-platform/src/routes/webhooks.rs`) receives
Telegram updates, resolves the entity from the bot token hash, and forwards
the message to the runtime's `/api/webhooks/telegram` endpoint. The runtime
routes the message to the agent's session via `SessionGateway`.

Outbound: agents call `telegram_reply` and `telegram_react` tools. These tools
are only injected into sessions bound to a `TelegramChannel`.

## Step-by-step setup

### 1. Create a bot with @BotFather

Open Telegram, message `@BotFather`:

```
/newbot
```

Follow the prompts. You get a BOT_TOKEN in the format:
`1234567890:ABCdefGHIjklmNOPqrstUVWxyz-12345678`

### 2. Set the environment variable

Add to `/etc/aeqi/secrets.env` on the aeqi server:

```bash
# Replace <entity_id> with the company's UUID, e.g. 8a3dfb3d-364e-4a9b-b62b-c326ae71439e
AEQI_TELEGRAM_BOT_TOKEN_<entity_id>=<YOUR_BOT_TOKEN>
```

Then restart the runtime service:

```bash
sudo systemctl restart aeqi-host-<entity_id>.service
# or for sandbox:
sudo systemctl restart aeqi-sandbox-<entity_id>.service
```

### 3. Register the webhook with Telegram

The platform uses a token hash in the webhook URL (not the raw token) to
prevent trivial token scraping from URLs. The hash is `sha256(BOT_TOKEN)`.

```bash
# Compute the hash
TOKEN="1234567890:ABCdefGHIjklmNOPqrstUVWxyz-12345678"
TOKEN_HASH=$(echo -n "$TOKEN" | sha256sum | awk '{print $1}')

# Register the webhook
curl -sk -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"https://app.aeqi.ai/api/webhooks/telegram/${TOKEN_HASH}\"}"
```

Expected response:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 4. Add a channel row to the agent

In aeqi, navigate to the company → Agents → `<agent>` → Integrations tab,
or use the API:

```bash
curl -sk -X POST "https://app.aeqi.ai/api/agents/<agent_id>/channels" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "X-Entity: <entity_id>" \
  -d '{
    "config": {
      "kind": "telegram",
      "token": "<BOT_TOKEN>",
      "allowed_chats": []
    }
  }'
```

An empty `allowed_chats` array means the agent responds to ALL chats the
bot is added to. To restrict:

```bash
"allowed_chats": [
  {"chat_id": "-1001234567890", "reply_allowed": true},
  {"chat_id": "9876543210",    "reply_allowed": false}
]
```

`reply_allowed: false` = agent receives the message but does not reply
automatically (read-only monitoring mode).

### 5. Test

Message your bot on Telegram. The message should appear in the agent's
session within a few seconds.

## AEIQ-specific setup

For the AEIQ dogfood company (`entity_id: 8a3dfb3d-364e-4a9b-b62b-c326ae71439e`):

1. Create three bots via @BotFather: one per assistant (CEO, CTO, COO),
   or one shared bot routed by mention prefix.

2. Recommended: one bot for COO Assistant (ops messages), one for CTO
   Assistant (engineering notifications). CEO channel via WhatsApp
   (already wired in the Baileys adapter).

3. Use the quest "Configure Telegram bot for AEIQ" in the AEIQ company
   for step-by-step tracking.

## Troubleshooting

**Bot does not respond**:
1. Check webhook is registered: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
2. Check the platform log: `sudo journalctl -u aeqi-platform.service -n 50 | grep telegram`
3. Confirm the runtime is running: `systemctl is-active aeqi-sandbox-<entity_id>.service`
4. Confirm `AEQI_TELEGRAM_BOT_TOKEN_<entity_id>` is set in the runtime env.

**Webhook returns 404 "unknown bot"**:
The token hash in the URL does not match any registered entity. Recompute
the hash and re-register: `echo -n "$TOKEN" | sha256sum`.

**Messages arrive but agent does not reply**:
Check `allowed_chats` — if the sending chat_id is not in the list (and list
is non-empty), the agent receives the message but `reply_allowed=false`
or the chat is not whitelisted. Add it or clear the whitelist.
