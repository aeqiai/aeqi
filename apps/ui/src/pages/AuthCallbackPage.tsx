import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const handleOAuthCallback = useAuthStore((s) => s.handleOAuthCallback);

  useEffect(() => {
    // Token comes in query string: /auth/callback?token=JWT
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (token) {
      handleOAuthCallback(token);
      // Check if user needs onboarding
      api
        .getMe()
        .then((me) => {
          const roots = (me.roots || me.companies) as unknown[] | undefined;
          if (!roots || roots.length === 0) {
            navigate("/new", { replace: true });
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
        <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
          Signing you in...
        </p>
      </div>
    </div>
  );
}
