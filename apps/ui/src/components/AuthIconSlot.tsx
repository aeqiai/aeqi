/**
 * Invisible 16x16 placeholder used by auth buttons that don't carry a brand
 * mark (Wallet, Passkey). Keeps "Continue with X" text starts aligned with
 * the icon-bearing OAuth buttons (Google, GitHub) — same flex slot, same
 * width, just not painted.
 */
export default function AuthIconSlot() {
  return (
    <span aria-hidden style={{ display: "inline-block", width: 16, height: 16, flexShrink: 0 }} />
  );
}
