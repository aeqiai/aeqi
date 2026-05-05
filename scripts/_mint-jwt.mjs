#!/usr/bin/env node
/**
 * Mint a Bearer JWT for the platform's auth middleware. Used by
 * scripts/audit-frontend.mjs and one-off curl smokes — anything that
 * needs to talk to authed endpoints without going through the email-
 * verification + session-creation login flow.
 *
 * The token has no `jti` claim, which is intentional: the platform's
 * auth middleware tolerates jti-less tokens (legacy fallback) without
 * checking the user_sessions table. That means we don't need to seed a
 * matching session row before the token works.
 *
 * Usage:
 *   AEQI_WEB_SECRET=... node scripts/_mint-jwt.mjs <user_id> <email> [ttl_seconds]
 *
 *   # default TTL = 600 (10 min)
 *   node scripts/_mint-jwt.mjs bbbd909d-... eqaq131@gmail.com
 *
 *   # via the live secrets file
 *   sudo -n cat /etc/aeqi/secrets.env | grep AEQI_WEB_SECRET
 *
 * Output: a single Bearer token to stdout. Pipe into curl:
 *   TOKEN=$(node scripts/_mint-jwt.mjs <uid> <email>)
 *   curl -H "Authorization: Bearer $TOKEN" https://app.aeqi.ai/api/auth/me
 */

import crypto from "node:crypto";

const [, , userId, email, ttlArg] = process.argv;
if (!userId || !email) {
  console.error(
    "usage: AEQI_WEB_SECRET=... node scripts/_mint-jwt.mjs <user_id> <email> [ttl_seconds]",
  );
  process.exit(1);
}

const secret = process.env.AEQI_WEB_SECRET;
if (!secret) {
  console.error("missing AEQI_WEB_SECRET in environment");
  process.exit(1);
}

const ttl = ttlArg ? parseInt(ttlArg, 10) : 600;
const now = Math.floor(Date.now() / 1000);

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64url(
  JSON.stringify({
    sub: userId,
    user_id: userId,
    email,
    iat: now,
    exp: now + ttl,
    // Intentionally no `jti` — the auth middleware skips the
    // user_sessions check when jti is absent (legacy-tolerance branch
    // in aeqi-platform/src/auth.rs).
  }),
);
const signingInput = `${header}.${payload}`;
const sig = b64url(crypto.createHmac("sha256", secret).update(signingInput).digest());

process.stdout.write(`${signingInput}.${sig}`);
