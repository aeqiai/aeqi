import { Link } from "react-router-dom";

import Wordmark from "@/components/Wordmark";

interface AuthMobileNavProps {
  ariaLabel: string;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}

export default function AuthMobileNav({
  ariaLabel,
  actionHref,
  actionLabel,
  className = "",
}: AuthMobileNavProps) {
  return (
    <header
      className={["auth-mobile-nav", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      <Link to="/" className="auth-mobile-nav-brand" aria-label="aeqi home">
        <Wordmark size={28} />
      </Link>
      {actionHref && actionLabel && (
        <Link to={actionHref} className="auth-mobile-nav-action">
          {actionLabel}
        </Link>
      )}
    </header>
  );
}
