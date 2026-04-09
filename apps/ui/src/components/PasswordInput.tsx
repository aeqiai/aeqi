import { useState } from "react";

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 3.8A6.4 6.4 0 018 3.5c4 0 6.5 4.5 6.5 4.5a10.7 10.7 0 01-1.3 1.7M9.4 9.4A2 2 0 016.6 6.6" />
    <path d="M1.5 8s1.2-2.2 3.2-3.5M1 1l14 14" />
  </svg>
);

export default function PasswordInput({
  value,
  onChange,
  placeholder = "Password",
  autoFocus,
  autoComplete,
  hasError,
  errorId,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  hasError?: boolean;
  errorId?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="auth-password-wrap">
      <input
        className={`auth-input auth-input-password${hasError ? " has-error" : ""}`}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-describedby={hasError && errorId ? errorId : undefined}
        aria-invalid={hasError || undefined}
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        autoComplete={autoComplete || "current-password"}
        name="password"
      />
      <button
        type="button"
        className="auth-password-toggle"
        onClick={() => setVisible(!visible)}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
