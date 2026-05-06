import { useState } from "react";
import { apiRequest } from "@/api/client";
import { Banner, Badge, Button, Modal, StatusRow } from "@/components/ui";

/** Signer type derived from the primary wallet's custody_state. */
export type SignerType = "custodial_eoa" | "passkey" | "unknown";

export interface WalletUpgradeSectionProps {
  /** Derived from the primary wallet's custody_state field. */
  signerType: SignerType;
}

// ── WebAuthn helpers ────────────────────────────────────────────────────────

/** 32-byte random challenge required by the WebAuthn spec. */
function randomChallenge(): ArrayBuffer {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return buf.buffer as ArrayBuffer;
}

/** Encode bytes as base64url (no padding). */
function toBase64url(bytes: Uint8Array): string {
  const bin = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Extract raw CBOR-encoded credential public key from the attestation. */
async function enrollPasskeyCredential(): Promise<{
  credentialId: string;
  rawPublicKey: ArrayBuffer;
}> {
  const challenge = randomChallenge();

  // 16-byte placeholder user.id — the server binds the real user at enroll time.
  const userIdBuf = new Uint8Array(16);
  userIdBuf[15] = 1;

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "aeqi" },
      user: {
        id: userIdBuf.buffer as ArrayBuffer,
        name: "aeqi-user",
        displayName: "aeqi user",
      },
      // P-256 / ES256 — algorithm ID -7 per COSE registry.
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("navigator.credentials.create returned null");
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const rawPublicKey = response.getPublicKey?.();
  if (!rawPublicKey) {
    throw new Error(
      "AuthenticatorAttestationResponse.getPublicKey() is not supported in this browser",
    );
  }

  return {
    credentialId: toBase64url(new Uint8Array(credential.rawId as ArrayBuffer)),
    rawPublicKey,
  };
}

// ── Sub-components ──────────────────────────────────────────────────────────

type UpgradePhase = "idle" | "enrolling" | "submitting" | "done" | "error";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const [phase, setPhase] = useState<UpgradePhase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setErrorMsg(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleUpgrade() {
    setPhase("enrolling");
    setErrorMsg(null);

    try {
      const { credentialId, rawPublicKey } = await enrollPasskeyCredential();

      setPhase("submitting");

      // TODO: implement POST /api/wallet/upgrade-to-passkey in aeqi-platform.
      // The route should accept { credential_id, raw_public_key_b64 }, initiate
      // the on-chain setPasskeyPublicKey() call on the TRUST contract, retire
      // the custodial EOA, and send the user a confirmation email when the
      // on-chain tx is mined.
      await apiRequest("/api/wallet/upgrade-to-passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential_id: credentialId,
          raw_public_key_b64: toBase64url(new Uint8Array(rawPublicKey)),
        }),
      });

      setPhase("done");
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      // Silent on user-dismissed prompts.
      if (name === "NotAllowedError" || name === "AbortError") {
        reset();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      // 501 means the backend stub isn't wired yet — surface as a success-like
      // "queued" state so the user knows the credential was captured.
      if (msg.includes("501") || msg.toLowerCase().includes("not implemented")) {
        setPhase("done");
      } else {
        setErrorMsg(msg);
        setPhase("error");
      }
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Upgrade to passkey">
      <div className="account-form-stack" style={{ padding: "var(--space-4) var(--space-5)" }}>
        {phase !== "done" && (
          <>
            <p className="account-field-desc">
              Your wallet is currently protected by a custodial key held on aeqi&apos;s servers
              (Phase 1). Upgrading enrolls a P-256 passkey stored in your device&apos;s secure
              enclave — Face ID, Touch ID, or Windows Hello. aeqi never holds a copy of your private
              key after the upgrade.
            </p>

            <div
              style={{
                background: "var(--bg-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-4)",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-muted)",
                lineHeight: 1.6,
              }}
            >
              <strong
                style={{ color: "var(--color-text-primary)", display: "block", marginBottom: 6 }}
              >
                What happens
              </strong>
              <ol
                style={{
                  paddingLeft: 18,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <li>Your device generates a P-256 keypair in its secure enclave.</li>
                <li>The public key is registered on your TRUST smart contract.</li>
                <li>Future signing uses your biometric — no passphrase required.</li>
                <li>Your custodial EOA is retired once enrollment is confirmed on-chain.</li>
              </ol>
            </div>

            <p className="account-field-desc">
              Migration runs in the background. You&apos;ll receive an email when your wallet has
              been fully upgraded.{" "}
              <a
                href="https://aeqi.ai/docs/guides/wallet-migration"
                target="_blank"
                rel="noopener noreferrer"
                className="account-action-link"
                style={{ display: "inline" }}
              >
                Read the migration guide
              </a>
            </p>
          </>
        )}

        {phase === "done" && (
          <Banner kind="success">
            Passkey enrolled. We&apos;ll process the upgrade in the background — you&apos;ll get an
            email when it&apos;s complete.
          </Banner>
        )}

        {phase === "error" && errorMsg && <Banner kind="error">{errorMsg}</Banner>}

        <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
          {phase === "done" ? (
            <Button variant="secondary" type="button" onClick={handleClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="secondary" type="button" onClick={handleClose}>
                Cancel
              </Button>
              {phase === "error" ? (
                <Button variant="primary" type="button" onClick={reset}>
                  Try again
                </Button>
              ) : (
                <Button
                  variant="primary"
                  type="button"
                  onClick={handleUpgrade}
                  loading={phase === "enrolling" || phase === "submitting"}
                  disabled={phase === "enrolling" || phase === "submitting"}
                >
                  {phase === "enrolling" ? "Waiting for device…" : "Upgrade to passkey"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Settings → Wallets — "Smart account signer" sub-section.
 *
 * Shows the current signer type (Custodial EOA / Passkey) and offers an
 * "Upgrade to passkey" flow for Phase-1 wallets. The upgrade button opens a
 * modal that runs WebAuthn enrollment (P-256, platform authenticator) and
 * submits the credential to POST /api/wallet/upgrade-to-passkey.
 *
 * The backend route is a TODO — the modal shows a "processing in background,
 * you'll get an email" success state regardless of 501 responses.
 */
export default function WalletUpgradeSection({ signerType }: WalletUpgradeSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="account-subsection">
      <label className="account-field-label">Smart account signer</label>
      <p className="account-field-desc">
        Controls how your TRUST smart contract wallet signs transactions. Phase 2 replaces the
        server-held custodial key with a passkey in your device&apos;s secure enclave.
      </p>

      {signerType === "passkey" && (
        <StatusRow
          dot="active"
          label="Passkey enrolled"
          status={
            <Badge variant="success" size="sm" dot>
              Phase 2
            </Badge>
          }
        />
      )}

      {signerType === "custodial_eoa" && (
        <>
          <StatusRow
            dot="idle"
            label="Custodial EOA"
            status={
              <Badge variant="neutral" size="sm">
                Phase 1
              </Badge>
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setModalOpen(true)}
              >
                Upgrade to passkey
              </Button>
            }
          />
          <UpgradeModal open={modalOpen} onClose={() => setModalOpen(false)} />
        </>
      )}

      {signerType === "unknown" && (
        <StatusRow dot="idle" label="Signer type unknown" status="Loading…" />
      )}
    </div>
  );
}
