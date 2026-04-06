import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const logout = useAuthStore((s) => s.logout);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => {});
  }, []);

  return (
    <>
      <Header title="Settings" />

      <div className="settings-grid">
        <div className="settings-section">
          <h3 className="settings-section-title">Daemon Connection</h3>
          <div className="detail-field">
            <div className="detail-field-label">Status</div>
            <div className="detail-field-value">
              {health?.ok ? (
                <span style={{ color: "var(--success)" }}>Connected</span>
              ) : (
                <span style={{ color: "var(--error)" }}>Disconnected</span>
              )}
            </div>
          </div>
          <div className="detail-field">
            <div className="detail-field-label">API URL</div>
            <div className="detail-field-value">
              <code>{import.meta.env.VITE_API_URL || "/api (proxied)"}</code>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3 className="settings-section-title">Session</h3>
          <button className="btn" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
