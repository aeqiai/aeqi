import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { getRedirectAfterAuth } from "@/lib/redirectAfterAuth";
import Wordmark from "@/components/Wordmark";
import { Button, Spinner } from "@/components/ui";
import { Events, useTrack } from "@/lib/analytics";

type State = "consuming" | "success" | "expired" | "missing";

export default function MagicLinkPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const track = useTrack();
  const loginWithMagicLink = useAuthStore((s) => s.loginWithMagicLink);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const consumed = useRef(false);
  const [state, setState] = useState<State>("consuming");

  useEffect(() => {
    document.title = "Signing in · aeqi";
  }, []);

  useEffect(() => {
    if (consumed.current) return;
    const token = params.get("token") ?? "";
    if (!token) {
      setState("missing");
      return;
    }
    // Guard against React 19 strict-mode double-mount: only fire once.
    consumed.current = true;
    loginWithMagicLink(token).then((ok) => {
      if (ok) {
        track(Events.AuthLogin, { method: "magic_link" });
        setState("success");
        navigate(getRedirectAfterAuth(params), { replace: true });
      } else {
        setState("expired");
      }
    });
  }, [params, loginWithMagicLink, navigate, track]);

  // If somehow already authed, just go where we'd go.
  useEffect(() => {
    if (state === "consuming" && isAuthenticated()) {
      navigate(getRedirectAfterAuth(params), { replace: true });
    }
  }, [state, isAuthenticated, navigate, params]);

  return (
    <main className="auth-page">
      <div className="auth-container" role="region" aria-live="polite">
        <div className="auth-logo">
          <Wordmark size={36} />
        </div>
        {state === "consuming" && (
          <>
            <h1 className="auth-heading">Signing you in</h1>
            <p className="auth-subheading auth-verifying">
              <Spinner size="sm" />
              One moment…
            </p>
          </>
        )}
        {state === "expired" && (
          <>
            <h1 className="auth-heading">Link expired</h1>
            <p className="auth-subheading">
              This sign-in link is no longer valid. Links are single-use and expire after 10
              minutes.
            </p>
            <div className="auth-form">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigate("/login", { replace: true })}
              >
                Get a new link
              </Button>
            </div>
          </>
        )}
        {state === "missing" && (
          <>
            <h1 className="auth-heading">Sign-in link incomplete</h1>
            <p className="auth-subheading">The link is missing a token. Try signing in again.</p>
            <div className="auth-form">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigate("/login", { replace: true })}
              >
                Back to sign in
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
