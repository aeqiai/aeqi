import { useMemo } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import type { RoleContextOption } from "@/lib/trustRoleContext";
import type { Trust } from "@/lib/types";

interface TrustRegistryStripProps {
  trusts: Trust[];
  activeTrustId: string | null;
  roleContexts: RoleContextOption[];
  onOpen: (trust: Trust) => void;
}

export default function TrustRegistryStrip({
  trusts,
  activeTrustId,
  roleContexts,
  onOpen,
}: TrustRegistryStripProps) {
  const roleCountByTrustId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const context of roleContexts) {
      counts.set(context.trust.id, (counts.get(context.trust.id) ?? 0) + 1);
    }
    return counts;
  }, [roleContexts]);

  if (trusts.length === 0) {
    return (
      <div className="trust-registry-empty">
        <Sparkles size={16} strokeWidth={1.6} aria-hidden />
        <span>Launch your first TRUST to create a public overview and private operating room.</span>
      </div>
    );
  }

  return (
    <div className="trust-registry-strip" aria-label="TRUST registry">
      {trusts.slice(0, 6).map((trust) => {
        const selected = trust.id === activeTrustId;
        const roleCount = roleCountByTrustId.get(trust.id) ?? 0;
        return (
          <button
            key={trust.id}
            type="button"
            className={selected ? "trust-registry-card is-active" : "trust-registry-card"}
            onClick={() => onOpen(trust)}
          >
            <TrustAvatar
              name={trust.name}
              src={trust.avatar}
              size={34}
              className="trust-registry-avatar"
            />
            <span className="trust-registry-copy">
              <span className="trust-registry-name">{trust.name}</span>
              <span className="trust-registry-meta">
                {trust.public ? "Public overview" : "Private"} · {roleCount}{" "}
                {roleCount === 1 ? "role" : "roles"}
              </span>
            </span>
            {trust.public ? (
              <ShieldCheck size={14} strokeWidth={1.7} aria-hidden />
            ) : (
              <LockKeyhole size={14} strokeWidth={1.7} aria-hidden />
            )}
            <ArrowRight className="trust-registry-arrow" size={14} strokeWidth={1.8} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
