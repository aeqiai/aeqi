import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/**
 * Two ways to get past this screen: paste / type the 6-digit code from
 * the email (auto-submits on the 6th digit) OR open the magic link in
 * the email on any device (mounts back into WelcomePage with `?token=`).
 * Cross-device: code + link are equivalent verifiers — either redeems
 * the same row, single-use enforced server-side.
 */
export default function CheckEmailView({
  email,
  onCodeSubmit,
  onResend,
  onBack,
}: {
  email: string;
  onCodeSubmit: (code: string) => void;
  onResend: () => Promise<void>;
  onBack: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number>(() => Date.now() + 60_000);
  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000));
  const canResend = remaining === 0 && !resending;

  const handleResend = async () => {
    if (!canResend) return;
    setResending(true);
    try {
      await onResend();
      setCooldownEndsAt(Date.now() + 60_000);
    } finally {
      setResending(false);
    }
  };

  const setDigit = (idx: number, value: string) => {
    const v = value.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = v;
      // Auto-submit when all 6 boxes are filled.
      if (v && idx === 5 && next.every((d) => d.length === 1)) {
        // Defer to next tick so React commits the state before submit.
        setTimeout(() => onCodeSubmit(next.join("")), 0);
      }
      return next;
    });
    if (v && idx < 5) inputRefs.current[idx + 1]?.focus();
  };

  const onKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setDigits(next);
    if (next.every((d) => d.length === 1)) {
      setTimeout(() => onCodeSubmit(next.join("")), 0);
    } else {
      inputRefs.current[Math.min(text.length, 5)]?.focus();
    }
  };

  return (
    <>
      <h1 className="auth-heading">Check your email</h1>
      <p className="auth-subheading">
        We sent a 6-digit code and a magic link to <strong>{email}</strong>. Type the code here, or
        open the link from any device.
      </p>
      <div
        className="verify-code-inputs"
        role="group"
        aria-label="Email verification code"
        onPaste={onPaste}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            className="verify-code-digit"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={onKeyDown(i)}
            aria-label={`Digit ${i + 1}`}
            autoFocus={i === 0}
          />
        ))}
      </div>
      <div className="auth-resend-row">
        <Button
          variant="ghost"
          size="md"
          type="button"
          onClick={handleResend}
          disabled={!canResend}
        >
          {resending ? "Sending…" : canResend ? "Resend code" : `Resend in ${remaining}s`}
        </Button>
      </div>
      <Button variant="secondary" size="lg" fullWidth type="button" onClick={onBack}>
        Use a different method
      </Button>
    </>
  );
}
