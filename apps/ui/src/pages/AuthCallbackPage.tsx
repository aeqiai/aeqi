import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const handleOAuthCallback = useAuthStore((s) => s.handleOAuthCallback);

  useEffect(() => {
    document.title = "signing in · æqi";
  }, []);

  useEffect(() => {
    // Token comes in query string: /auth/callback?token=JWT
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (token) {
      handleOAuthCallback(token);
      // Check if user needs onboarding — no companies → /start (the
      // single launch surface) so they spend their trial slot
      // intentionally. With companies → home.
      api
        .getMe()
        .then((me) => {
          const roots = (me.roots || me.companies) as unknown[] | undefined;
          if (!roots || roots.length === 0) {
            navigate("/start", { replace: true });
          } else {
            navigate("/", { replace: true });
          }
        })
        .catch(() => {
          navigate("/", { replace: true });
        });
    } else {
      navigate("/login", { replace: true });
    }
  }, [handleOAuthCallback, navigate]);

  return (
    <div className="login-page">
      <div className="login-card">
        <p
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          <Spinner size="sm" />
          Signing you in…
        </p>
      </div>
    </div>
  );
}
