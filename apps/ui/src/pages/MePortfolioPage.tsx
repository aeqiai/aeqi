import { useEffect } from "react";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * `/me/portfolio` — your equity, treasury share, and ownership across
 * every company you hold a stake in. Stub today; the real surface
 * lands when the on-chain cap-table primitive ships and treasury
 * positions exist for the user's wallet.
 */
export default function MePortfolioPage() {
  useEffect(() => {
    document.title = "my portfolio · æqi";
  }, []);

  return (
    <div className="me-stub">
      <header className="me-stub-header">
        <h1 className="me-stub-heading">My portfolio</h1>
        <p className="me-stub-sub">Your equity, treasury share, and ownership across companies.</p>
      </header>
      <EmptyState
        title="Portfolio coming soon."
        description="Cap-table positions, treasury balances, and revenue share land with the on-chain ownership primitive."
      />
    </div>
  );
}
