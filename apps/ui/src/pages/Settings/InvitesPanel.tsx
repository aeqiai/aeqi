import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

interface InviteCode {
  code: string;
  used: boolean;
}

/**
 * Settings → Invites tab. Surfaces single-use invite codes the user
 * can share. Copy-to-clipboard with a brief "Copied!" affordance.
 */
export default function InvitesPanel() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [copiedCode, setCopiedCode] = useState("");

  useEffect(() => {
    api
      .getInviteCodes()
      .then((data: Record<string, unknown>) => {
        const list = (data as { codes?: InviteCode[] }).codes;
        if (Array.isArray(list)) setCodes(list);
      })
      .catch(() => {});
  }, []);

  const copy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 2000);
  };

  return (
    <>
      <p className="account-field-desc account-invites-desc">
        Share invite codes with friends. Each code is single-use. New users get 3 codes of their
        own.
      </p>
      {codes.length === 0 ? (
        <div className="account-invites-empty">No invite codes available.</div>
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
