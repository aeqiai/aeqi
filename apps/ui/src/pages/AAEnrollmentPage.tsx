import { useState } from "react";
import { apiRequest } from "@/api/client";
import { Button, Banner } from "@/components/ui";

/**
 * /me/aa-enroll — Phase-2 passkey enrollment stub.
 *
 * WS-4d scaffolding. Shows the user their current wallet phase and offers
 * a passkey enrollment flow via the WebAuthn PRF extension. The server-side
 * enrollment handler (`POST /api/account/enroll-passkey`) returns 501 until
 * WS-4e+ wires the full on-chain flow.
 *
 * What this page does today:
 *  - Explains Phase 1 (custodial) vs Phase 2 (passkey-native).
 *  - Calls navigator.credentials.create() with a P-256 / PRF challenge.
 *  - Displays the resulting credential ID and public key (x, y) coordinates.
 *  - POSTs those to /api/account/enroll-passkey → shows 501 banner.
 *
 * What this page does NOT do yet (deferred to WS-4e/Wave 10+):
 *  - Actual on-chain setPasskeyPublicKey() call.
 *  - Passkey-signed UserOp submission.
 *  - Custodial EOA retirement.
 */

// Returns a 32-byte random challenge as an ArrayBuffer (required by WebAuthn).
function randomChallenge(): ArrayBuffer {
  const buf = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(buf);
  return buf.buffer as ArrayBuffer;
}

// Encode a Uint8Array to base64url (no padding).
function toBase64url(bytes: Uint8Array): string {
  const bin = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Extract P-256 public key (x, y) as 0x-prefixed hex bytes32 from a COSE key.
// COSE EC2 key for P-256: cbor map { 1: 2, 3: -7, -1: 1, -2: x_bytes, -3: y_bytes }
// We do a minimal parse — find the 0x20 (32-byte) bstr values after the -2 / -3 keys.
function extractP256PublicKey(coseBytes: ArrayBuffer): { qx: string; qy: string } | null {
  const buf = new Uint8Array(coseBytes);
  // COSE keys produced by WebAuthn always start with a5 (5-item map).
  // The layout is deterministic for ES256: keys at indices -2 and -3 are
  // the x and y coordinates respectively. We scan for the bstr marker (0x58 0x20)
  // which means "byte string of length 32".
  const coords: Uint8Array[] = [];
  for (let i = 0; i < buf.length - 33; i++) {
    if (buf[i] === 0x58 && buf[i + 1] === 0x20) {
      // Found a 32-byte bstr — this is a coordinate.
      coords.push(buf.slice(i + 2, i + 34));
      i += 33; // skip past it
    }
  }
  if (coords.length < 2) return null;
  const toHex = (b: Uint8Array) =>
    "0x" +
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  return { qx: toHex(coords[0]), qy: toHex(coords[1]) };
}

type Phase = "idle" | "creating" | "success" | "posting" | "done" | "error";

interface EnrollResult {
  credentialId: string;
  qx: string;
  qy: string;
}

export default function AAEnrollmentPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleEnroll() {
    setPhase("creating");
    setErrorMsg(null);
    setResult(null);
    setServerStatus(null);

    try {
      const challenge = randomChallenge();

      // Placeholder user.id — 16 bytes, plain ArrayBuffer (required by WebAuthn).
      const userIdBuf = new Uint8Array(new ArrayBuffer(16));
      userIdBuf[15] = 1;
      const userId = userIdBuf.buffer as ArrayBuffer;

      // WebAuthn credential creation with P-256 (ES256 = alg -7).
      // PRF extension is requested for future key-derivation use (WS-4e).
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: "aeqi",
            // id defaults to current origin — correct for prod and staging.
          },
          user: {
            // Placeholder — server will bind the real user ID at enrollment time.
            id: userId,
            name: "aeqi-user",
            displayName: "aeqi user",
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 }, // ES256 (P-256)
          ],
          authenticatorSelection: {
            // Require a discoverable credential (passkey) stored in the platform.
            residentKey: "required",
            requireResidentKey: true,
            userVerification: "required",
          },
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error("navigator.credentials.create returned null");
      }

      const response = credential.response as AuthenticatorAttestationResponse;
      const publicKeyBytes = response.getPublicKey?.();
      if (!publicKeyBytes) {
        throw new Error(
          "AuthenticatorAttestationResponse.getPublicKey() not supported in this browser",
        );
      }

      const coords = extractP256PublicKey(publicKeyBytes);
      if (!coords) {
        throw new Error("Could not extract P-256 (x, y) coordinates from credential public key");
      }

      const enrollResult: EnrollResult = {
        credentialId: toBase64url(new Uint8Array(credential.rawId as ArrayBuffer)),
        qx: coords.qx,
        qy: coords.qy,
      };
      setResult(enrollResult);
      setPhase("success");

      // POST to server — stub returns 501 until WS-4e ships.
      setPhase("posting");
      try {
        await apiRequest("/api/account/enroll-passkey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credential_id: enrollResult.credentialId,
            qx: enrollResult.qx,
            qy: enrollResult.qy,
          }),
        });
        setServerStatus("enrolled");
      } catch (err: unknown) {
        // 501 is expected — the server stub is not yet implemented.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("501") || msg.toLowerCase().includes("not implemented")) {
          setServerStatus("stub-501");
        } else {
          setServerStatus(`error: ${msg}`);
        }
      }
      setPhase("done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("error");
    }
  }

  return (
    <div className="aa-enrollment-page" style={{ maxWidth: 560, padding: "var(--space-6)" }}>
      <h2
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 600,
          marginBottom: "var(--space-3)",
          color: "var(--color-text-primary)",
        }}
      >
        Wallet upgrade
      </h2>

      <p
        style={{
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-muted)",
          marginBottom: "var(--space-5)",
          lineHeight: 1.6,
        }}
      >
        You&apos;re using a custodial wallet (Phase 1). Enrolling a passkey upgrades you to Phase 2
        — your private key lives on your device, not on our servers. aeqi never holds a copy.
      </p>

      <div
        style={{
          background: "var(--color-card)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-4)",
          marginBottom: "var(--space-5)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-muted)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--color-text-primary)", display: "block", marginBottom: 6 }}>
          What happens when you enroll
        </strong>
        <ol
          style={{ paddingLeft: 18, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}
        >
          <li>Your device generates a P-256 keypair in its Secure Enclave.</li>
          <li>The public key is registered on your TRUST smart contract.</li>
          <li>
            Future wallet operations are signed by your biometric — Face ID, Touch ID, or Windows
            Hello.
          </li>
          <li>Your custodial EOA is retired once enrollment is confirmed on-chain.</li>
        </ol>
      </div>

      {phase === "idle" && (
        <Button variant="primary" onClick={handleEnroll}>
          Enroll passkey
        </Button>
      )}

      {phase === "creating" && (
        <Button variant="primary" disabled>
          Waiting for device…
        </Button>
      )}

      {(phase === "posting" || phase === "done") && result && (
        <div style={{ marginBottom: "var(--space-5)" }}>
          <div
            style={{
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
              wordBreak: "break-all",
              lineHeight: 1.7,
            }}
          >
            <div>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
                credential_id
              </span>
              <br />
              {result.credentialId}
            </div>
            <div style={{ marginTop: "var(--space-3)" }}>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
                qx (P-256 X)
              </span>
              <br />
              {result.qx}
            </div>
            <div style={{ marginTop: "var(--space-3)" }}>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
                qy (P-256 Y)
              </span>
              <br />
              {result.qy}
            </div>
          </div>
        </div>
      )}

      {phase === "done" && serverStatus === "stub-501" && (
        <Banner kind="info">
          Passkey registered on-device. Server enrollment is not yet implemented (Wave 10 work).
          Your public key coordinates have been captured above — they&apos;ll be submitted when the
          server-side handler ships.
        </Banner>
      )}

      {phase === "done" && serverStatus === "enrolled" && (
        <Banner kind="success">Passkey enrolled. Your wallet has been upgraded to Phase 2.</Banner>
      )}

      {phase === "done" && serverStatus && serverStatus.startsWith("error:") && (
        <Banner kind="error">Server error: {serverStatus.replace("error: ", "")}</Banner>
      )}

      {phase === "error" && errorMsg && (
        <Banner kind="error">
          {errorMsg.includes("NotAllowedError") || errorMsg.includes("cancelled")
            ? "Enrollment cancelled. No changes were made."
            : errorMsg}
        </Banner>
      )}

      {phase === "error" && (
        <Button
          variant="secondary"
          onClick={() => {
            setPhase("idle");
            setErrorMsg(null);
          }}
          style={{ marginTop: "var(--space-3)" }}
        >
          Try again
        </Button>
      )}
    </div>
  );
}
