import { Button } from "@/components/ui";

interface TrustOwnershipTransferControlProps {
  /** Whether the trust is provisioned on-chain. Even when the on-chain
   *  instruction lands, an unprovisioned trust has no authority to
   *  transfer, so the affordance is meaningless. */
  hasTrustAddress: boolean;
}

/**
 * Placeholder for ja-023 Phase B — "Sell entire TRUST" via ownership
 * transfer. The placement owner rotates the on-chain `Trust.authority`
 * to a new principal, irrevocably handing the whole TRUST PDA over.
 *
 * The on-chain `aeqi-trust` program does NOT yet expose an instruction
 * to mutate `Trust.authority` after `initialize` — the field is write-
 * once. Quest `platform-019` tracks adding `transfer_authority`. Until
 * then this surface lives as a disabled "Coming soon" footer under the
 * Ownership card row so the section is visible and the next pass knows
 * where the live action belongs.
 *
 * When the on-chain ix lands, swap the disabled button for a live one
 * that opens a ConfirmDialog with a type-the-trust-name irreversibility
 * guard (mirror the GitHub repo-delete pattern) before calling
 * `api.trustTransferAuthority`. Spec lives in the platform-019 quest.
 */
export default function TrustOwnershipTransferControl({
  hasTrustAddress,
}: TrustOwnershipTransferControlProps) {
  return (
    <section className="trust-transfer-control" aria-labelledby="trust-transfer-heading">
      <div className="trust-transfer-control-text">
        <h3 id="trust-transfer-heading" className="trust-transfer-control-title">
          Transfer ownership
          <span className="trust-transfer-control-tag">Coming soon</span>
        </h3>
        <p className="trust-transfer-control-body">
          Hand the whole TRUST over to a new principal. The new owner inherits the authority key and
          every module that defers to it. This is the on-chain equivalent of selling the company;
          once signed, it cannot be undone.
        </p>
      </div>
      <div className="trust-transfer-control-action">
        <Button variant="danger" size="md" disabled aria-disabled="true">
          {hasTrustAddress ? "Transfer TRUST ownership" : "TRUST not yet provisioned"}
        </Button>
      </div>
    </section>
  );
}
