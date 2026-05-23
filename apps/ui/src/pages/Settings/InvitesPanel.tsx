import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

interface InviteCode {
  code: string;
  used: boolean;
}

/**
 * Settings → Invites tab. Admin-only — renders nothing for regular users.
 * Founder mints invite codes on demand to onboard friends and family on
 * the invite tier (no billing) before public launch.
 */
export default function InvitesPanel() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [copiedCode, setCopiedCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const load = () => {
    api
      .getInviteCodes()
      .then((data: Record<string, unknown>) => {
        const list = (data as { codes?: InviteCode[] }).codes;
        if (Array.isArray(list)) setCodes(list);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.includes("403")) {
          setForbidden(true);
        }
      });
  };

  useEffect(() => {
    load();
  }, []);

  const copy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 2000);
  };

  const generate = async () => {
    setCreating(true);
    try {
      await api.createInviteCode();
      load();
    } finally {
      setCreating(false);
    }
  };

  if (forbidden) return null;

  return (
    <>
      <p className="account-field-desc account-invites-desc">
        Mint single-use invite codes for friends and family. Redeemers join on the invite tier — no
        billing, no recursive invites.
      </p>
      <div className="account-invites-actions">
        <Button variant="primary" size="sm" onClick={generate} disabled={creating}>
          {creating ? "Generating…" : "Generate code"}
        </Button>
      </div>
      {codes.length === 0 ? (
        <div className="account-invites-empty">No invite codes yet.</div>
      ) : (
        <div className="account-invites-list">
          {codes.map((inv) => (
            <div
              key={inv.code}
              className={`account-invite-item ${inv.used ? "account-invite-item--used" : "account-invite-item--available"}`}
            >
              <code
                className={`account-invite-code ${inv.used ? "account-invite-code--used" : "account-invite-code--available"}`}
              >
                {inv.code}
              </code>
              {inv.used ? (
                <span className="account-invite-used-label">Used</span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="account-invite-copy-btn"
                  onClick={() => copy(inv.code)}
                >
                  {copiedCode === inv.code ? "Copied!" : "Copy"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
