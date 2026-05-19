import { useEffect, useState } from "react";
import { useDaemonStore } from "@/store/daemon";
import { fetchTrust } from "@/lib/indexer";
import { entityBasePath } from "@/lib/entityPath";
import TrustHeroStrip from "./TrustHeroStrip";
import TrustExecutionGroup from "./TrustExecutionGroup";
import TrustOwnershipGroup from "./TrustOwnershipGroup";
import TrustPublicRow from "./TrustPublicRow";
import "@/styles/overview.css";

/**
 * `/trust/<addr>/overview` — TRUST cockpit (v3, 2026-05-19).
 *
 * Page composition mirrors AEQI's mental model directly:
 *
 *   1. Hero (full width) — identity. Avatar plate + display name +
 *      tagline + plan/public chrome.
 *   2. Programmable Execution group — runtime header bar + 4 cards:
 *      Agents, Quests, Events, Ideas. The state band that lived as
 *      its own row in v2 folds into this header (runtime = execution).
 *   3. Programmable Ownership group — on-chain identity header bar
 *      (TRUST address + signers + smart-contract chip) + 4 cards:
 *      Assets, Equity, Quorum, Incorporation. The identity strip
 *      that lived as its own row in v2 folds into this header.
 *   4. Public surface (half/half) — Updates (timeline) + Data Room
 *      (documents). Placeholders for now; structure is what matters.
 *
 * Two retired sections from v2:
 *   · Pulse band (3 cards: awaiting decisions / next steps / 24h) →
 *     subsumed by the 4 Execution cards. Each carries its own count.
 *   · Health block (substrate compounding) → folded into the Events
 *     card. Activity count IS the compounding signal.
 */
export default function TrustOverviewTab({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((e) => e.id === trustId);
  const trustAddress = entity?.trust_address;
  const basePath = entity ? entityBasePath(entity) : "/launch";

  // On-chain signers count — only signal we still source directly on
  // the overview surface; the four ownership-card hooks own everything
  // else. Could move into a useTrustSigners hook later.
  const [signersCount, setSignersCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!trustAddress) {
      setSignersCount(null);
      return;
    }
    fetchTrust(trustAddress)
      .then((trust) => {
        if (cancelled) return;
        setSignersCount(trust?.signersCount ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setSignersCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  return (
    <div className="trust-overview">
      <TrustHeroStrip trustId={trustId} />
      <TrustExecutionGroup trustId={trustId} basePath={basePath} />
      <TrustOwnershipGroup
        trustAddress={trustAddress}
        basePath={basePath}
        signersCount={signersCount}
      />
      <TrustPublicRow />
    </div>
  );
}
