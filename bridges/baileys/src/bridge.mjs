#!/usr/bin/env node
// AEQI ↔ Baileys bridge.
//
// Protocol: JSON-lines over stdio. Every message is one JSON object per line.
//   Commands (Rust → bridge):   {"id": "<uuid>", "method": "<name>", "params": {...}}
//   Responses (bridge → Rust):  {"id": "<uuid>", "result": {...}}  OR  {"id": "<uuid>", "error": "..."}
//   Events (bridge → Rust):     {"event": "<name>", "data": {...}}  (no id)
//
// stdout is the wire. stderr is the log channel — the supervisor forwards
// it to `tracing` so Baileys warnings surface in gateway logs.
//
// Methods:
//   ping                                              — smoke test
//   start({session_dir})                              — open auth state, connect; emits qr/connecting/ready/disconnected
//   send_text({jid, text})                            — send plain text message
//   send_reply({jid, text, quoted_id, quoted_remote_jid?, quoted_from_me?, participant?}) — send quoted reply
//   send_reaction({jid, message_id, emoji, from_me?, participant?}) — send emoji reaction
//   logout                                            — sign out and wipe credentials (user will need to re-scan QR)
//   shutdown                                          — close socket, exit 0
//
// Events:
//   ready        {jid, name?}
//   connecting   {}
//   qr           {qr, data_url}
//   disconnected {reason, should_reconnect}
//   message_in   {id, jid, from_me, self_chat, is_group, text, timestamp}

import readline from "node:readline";
import path from "node:path";
import fs from "node:fs/promises";
import qrcode from "qrcode";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  areJidsSameUser,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";

const rl = readline.createInterface({ input: process.stdin });
const logger = pino({ level: process.env.AEQI_BAILEYS_LOG || "warn" }, process.stderr);

let sock = null;
let sessionDir = null;
let reconnectTimer = null;

// Message ids we just sent, so `messages.upsert` can distinguish our own
// echoes (drop) from a genuine chat-with-yourself message (forward).
// Ordered Set; cap at 512, drop oldest on overflow.
const sentMessageIds = new Set();
function rememberSent(id) {
  if (!id) return;
  sentMessageIds.add(id);
  if (sentMessageIds.size > 512) {
    const oldest = sentMessageIds.values().next().value;
    sentMessageIds.delete(oldest);
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function emit(event, data) {
  send({ event, data: data ?? null });
}

function normalizeJid(jid) {
  return jid ? jidNormalizedUser(jid) : null;
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption;
  if (m.ephemeralMessage?.message?.conversation)
    return m.ephemeralMessage.message.conversation;
  if (m.ephemeralMessage?.message?.extendedTextMessage?.text)
    return m.ephemeralMessage.message.extendedTextMessage.text;
  return null;
}

async function startSocket(dir) {
  await fs.mkdir(dir, { recursive: true });
  sessionDir = dir;
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    auth: state,
    version,
    logger,
    browser: Browsers.appropriate("AEQI"),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        const dataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
        emit("qr", { qr, data_url: dataUrl });
      } catch (e) {
        emit("qr", { qr, data_url: null });
      }
    }
    if (connection === "connecting") {
      emit("connecting", {});
    } else if (connection === "open") {
      const meJid = normalizeJid(sock.user?.id);
      emit("ready", { jid: meJid, name: sock.user?.name ?? null });
    } else if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason =
        Object.keys(DisconnectReason).find((k) => DisconnectReason[k] === code) ||
        lastDisconnect?.error?.message ||
        "unknown";
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      emit("disconnected", { reason, should_reconnect: shouldReconnect, code: code ?? null });
      sock = null;
      if (shouldReconnect && sessionDir) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          startSocket(sessionDir).catch((e) =>
            process.stderr.write(`[bridge] reconnect failed: ${e?.message || e}\n`),
          );
        }, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const text = extractText(msg);
      if (text === null) continue;
      const jid = normalizeJid(msg.key.remoteJid);
      const fromMe = !!msg.key.fromMe;
      const meJid = normalizeJid(sock?.user?.id);
      const isSelfChat = !!jid && !!meJid && areJidsSameUser(jid, meJid);
      // Drop our own replies bouncing back through the event stream.
      // Also drop self-authored messages to other chats; only a real
      // chat-with-yourself thread should wake the agent.
      if (fromMe && sentMessageIds.has(msg.key.id)) {
        sentMessageIds.delete(msg.key.id);
        continue;
      }
      if (fromMe && !isSelfChat) {
        continue;
      }
      emit("message_in", {
        id: msg.key.id,
        jid,
        from_me: fromMe,
        self_chat: isSelfChat,
        is_group: jid?.endsWith("@g.us") ?? false,
        participant: normalizeJid(msg.key.participant),
        push_name: msg.pushName ?? null,
        text,
        timestamp: Number(msg.messageTimestamp ?? 0),
      });
    }
  });
}

async function handle(method, params) {
  switch (method) {
    case "ping":
      return { pong: true, received: params ?? null };

    case "start": {
      const dir = params?.session_dir;
      if (!dir || typeof dir !== "string") {
        throw new Error("start: session_dir (string) required");
      }
      if (sock) {
        return { already_running: true, session_dir: sessionDir };
      }
      await startSocket(path.resolve(dir));
      return { started: true, session_dir: sessionDir };
    }

    case "send_text": {
      if (!sock) throw new Error("send_text: socket not started");
      const { jid, text } = params ?? {};
      if (!jid || typeof jid !== "string") throw new Error("send_text: jid required");
      if (typeof text !== "string") throw new Error("send_text: text required");
      const res = await sock.sendMessage(jid, { text });
      rememberSent(res?.key?.id);
      return { id: res?.key?.id ?? null, jid };
    }

    case "send_reply": {
      if (!sock) throw new Error("send_reply: socket not started");
      const { jid, text, quoted_id, quoted_remote_jid, quoted_from_me, participant } = params ?? {};
      if (!jid || typeof jid !== "string") throw new Error("send_reply: jid required");
      if (typeof text !== "string") throw new Error("send_reply: text required");
      if (!quoted_id || typeof quoted_id !== "string") throw new Error("send_reply: quoted_id required");
      // Baileys needs a minimal proto message with key to thread the reply.
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

    case "send_reaction": {
      if (!sock) throw new Error("send_reaction: socket not started");
      const { jid, message_id, emoji, from_me, participant } = params ?? {};
      if (!jid || typeof jid !== "string") throw new Error("send_reaction: jid required");
      if (!message_id || typeof message_id !== "string") throw new Error("send_reaction: message_id required");
      if (!emoji || typeof emoji !== "string") throw new Error("send_reaction: emoji required");
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

    case "logout": {
      if (sock) {
        try {
          await sock.logout();
        } catch (_) {
          // Already disconnected — still wipe creds.
        }
        sock = null;
      }
      if (sessionDir) {
        await fs.rm(sessionDir, { recursive: true, force: true });
      }
      return { logged_out: true };
    }

    case "shutdown":
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (sock) {
        try {
          sock.end(undefined);
        } catch (_) {
          // ignore
        }
      }
      setTimeout(() => process.exit(0), 50);
      return { shutting_down: true };

    default:
      throw new Error(`unknown method: ${method}`);
  }
}

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (e) {
    process.stderr.write(`[bridge] bad json: ${trimmed}\n`);
    return;
  }
  const { id, method, params } = msg;
  try {
    const result = await handle(method, params);
    if (id) send({ id, result: result ?? null });
  } catch (e) {
    if (id) send({ id, error: e?.message || String(e) });
    else process.stderr.write(`[bridge] unsolicited error: ${e?.message || e}\n`);
  }
});

rl.on("close", () => process.exit(0));

process.on("uncaughtException", (e) => {
  process.stderr.write(`[bridge] uncaught: ${e?.stack || e}\n`);
});
process.on("unhandledRejection", (e) => {
  process.stderr.write(`[bridge] unhandled rejection: ${e?.stack || e}\n`);
});

emit("ready_bridge", { phase: 2, bridge: "baileys" });
