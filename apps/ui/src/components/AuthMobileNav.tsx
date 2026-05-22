import { Link } from "react-router-dom";

import Wordmark from "@/components/Wordmark";

interface AuthMobileNavProps {
  ariaLabel: string;
  actionHref?: string;
  actionLabel?: string;
  actionOnClick?: () => void;
  className?: string;
}

export default function AuthMobileNav({
  ariaLabel,
  actionHref,
  actionLabel,
  actionOnClick,
  className = "",
}: AuthMobileNavProps) {
  return (
    <nav
      className={["auth-mobile-nav", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      <Link to="/" className="auth-mobile-nav-brand" aria-label="aeqi home">
        <Wordmark size={28} />
      </Link>
      {actionOnClick && actionLabel ? (
        <button type="button" className="auth-mobile-nav-action" onClick={actionOnClick}>
          {actionLabel}
        </button>
      ) : actionHref && actionLabel ? (
        <Link to={actionHref} className="auth-mobile-nav-action">
          {actionLabel}
        </Link>
      ) : null}
    </nav>
  );
}
