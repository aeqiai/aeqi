import { Button } from "@/components/ui";

interface CompanyOwnershipTransferControlProps {
  /** Whether the company is provisioned on-chain. Even when the on-chain
   *  instruction lands, an unprovisioned company has no authority to
   *  transfer, so the affordance is meaningless. */
  hasCompanyAddress: boolean;
}

/**
 * Placeholder for ja-023 Phase B — "Sell entire COMPANY" via ownership
 * transfer. The placement owner rotates the on-chain `Company.authority`
 * to a new principal, irrevocably handing the whole COMPANY PDA over.
 *
 * The on-chain `aeqi-company` program does NOT yet expose an instruction
 * to mutate `Company.authority` after `initialize` — the field is write-
 * once. Quest `platform-019` tracks adding `transfer_authority`. Until
 * then this surface lives as a disabled "Coming soon" footer under the
 * Ownership card row so the section is visible and the next pass knows
 * where the live action belongs.
 *
 * When the on-chain ix lands, swap the disabled button for a live one
 * that opens a ConfirmDialog with a type-the-company-name irreversibility
 * guard (mirror the GitHub repo-delete pattern) before calling
 * `api.trustTransferAuthority`. Spec lives in the platform-019 quest.
 */
export default function CompanyOwnershipTransferControl({
  hasCompanyAddress,
}: CompanyOwnershipTransferControlProps) {
  return (
    <section className="company-transfer-control" aria-labelledby="company-transfer-heading">
      <div className="company-transfer-control-text">
        <h3 id="company-transfer-heading" className="company-transfer-control-title">
          Transfer ownership
          <span className="company-transfer-control-tag">Coming soon</span>
        </h3>
        <p className="company-transfer-control-body">
          Hand the whole COMPANY over to a new principal. The new owner inherits the authority key
          and every module that defers to it. This is the on-chain equivalent of selling the
          company; once signed, it cannot be undone.
        </p>
      </div>
      <div className="company-transfer-control-action">
        <Button variant="danger" size="md" disabled aria-disabled="true">
          {hasCompanyAddress ? "Transfer COMPANY ownership" : "COMPANY not yet provisioned"}
        </Button>
      </div>
    </section>
  );
}
