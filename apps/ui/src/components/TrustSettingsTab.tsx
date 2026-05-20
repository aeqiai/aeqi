import { useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import TrustOwnershipTransferControl from "./TrustOwnershipTransferControl";
import "./TrustSettingsTab.css";

interface TrustSettingsTabProps {
  trustId: string;
}

/**
 * Trust-level settings surface. Lives at `/trust/<addr>/settings`. Home for
 * irreversible administrative actions on a TRUST that don't belong inside
 * the day-to-day ownership/governance rails — currently ownership
 * transfer; future tenants: archival, principal rotation, runtime detach.
 */
export default function TrustSettingsTab({ trustId }: TrustSettingsTabProps) {
  const entities = useDaemonStore((s) => s.entities);
  const trust = useMemo(() => entities.find((e) => e.id === trustId), [entities, trustId]);
  const trustAddress = trust?.trust_address ?? null;

  return (
    <div className="trust-settings-tab">
      <header className="trust-settings-header">
        <h1 className="trust-settings-title">Settings</h1>
        <p className="trust-settings-subtitle">
          Administrative actions on this TRUST. Operations here are irreversible — handle with
          intent.
        </p>
      </header>
      <section className="trust-settings-section">
        <h2 className="trust-settings-section-title">Ownership</h2>
        <TrustOwnershipTransferControl hasTrustAddress={!!trustAddress} />
      </section>
    </div>
  );
}
