import { WizardPanel } from "./WizardPanel";
import { Button } from "@/components/ui";
import type { IdentityState } from "./WizardIdentityPanel";
import type { RoleSeat, InviteRow } from "./WizardRolesPanel";
import type { TokenState } from "./WizardTokenPanel";
import type { VestingState } from "./WizardVestingPanel";
import type { GovernanceState } from "./WizardGovernancePanel";
import styles from "./WizardReviewPanel.module.css";

export interface WizardState {
  identity: IdentityState;
  seats: RoleSeat[];
  invites: InviteRow[];
  token: TokenState | null;
  vesting: VestingState | null;
  governance: GovernanceState | null;
}

interface WizardReviewPanelProps {
  state: WizardState;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Review panel — summary of all wizard state + stub calldata preview.
 *
 * Includes the disabled Create company button.
 * The <pre> calldata block is a JSON stub; real ABI-encoded calldata
 * is wired once WS-1 (dao_provisioner encoder) lands.
 */
export function WizardReviewPanel({ state, expanded, onToggle }: WizardReviewPanelProps) {
  const founderCount = state.seats.filter((s) => s.roleType === "founder").length;
  const directorCount = state.seats.filter((s) => s.roleType === "director").length;
  const workerCount = state.seats.filter((s) => s.roleType === "worker").length;
  const summary = `${state.identity.name || "Unnamed"} · ${state.seats.length} roles`;

  const calldataPreview = JSON.stringify(
    {
      blueprint: "preview",
      identity: state.identity,
      roles: {
        seats: state.seats.map((s) => ({
          key: s.key,
          title: s.title,
          roleType: s.roleType,
          occupant: s.occupant,
        })),
        invites: state.invites,
      },
      ...(state.token ? { token: state.token } : {}),
      ...(state.vesting ? { vesting: state.vesting } : {}),
      ...(state.governance ? { governance: state.governance } : {}),
    },
    null,
    2,
  );

  return (
    <WizardPanel
      id="wizard-review"
      title="Review"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className={styles.summary}>
        <h3 className={styles.summaryHeading}>What gets created</h3>
        <div className={styles.summaryGrid}>
          <ReviewRow label="Company name" value={state.identity.name || "Not set"} />
          <ReviewRow label="Slug" value={state.identity.slug || "Not set"} />
          {founderCount > 0 && (
            <ReviewRow
              label="Founders"
              value={`${founderCount} seat${founderCount !== 1 ? "s" : ""}`}
            />
          )}
          {directorCount > 0 && (
            <ReviewRow
              label="Directors"
              value={`${directorCount} seat${directorCount !== 1 ? "s" : ""}`}
            />
          )}
          {workerCount > 0 && (
            <ReviewRow
              label="Workers"
              value={`${workerCount} seat${workerCount !== 1 ? "s" : ""}`}
            />
          )}
          {state.invites.length > 0 && (
            <ReviewRow
              label="Invites pending"
              value={`${state.invites.length} co-director${state.invites.length !== 1 ? "s" : ""}`}
            />
          )}
          {state.token && (
            <>
              <ReviewRow label="Token" value={`${state.token.name} (${state.token.symbol})`} />
              <ReviewRow
                label="Max supply"
                value={Number(state.token.maxSupply || 0).toLocaleString()}
              />
            </>
          )}
          {state.vesting && (
            <ReviewRow
              label="Vesting"
              value={state.vesting.schedules
                .map((s) => `${s.roleType} ${s.durationYears}yr/${s.cliffMonths}mo cliff`)
                .join(", ")}
            />
          )}
          {state.governance && (
            <ReviewRow
              label="Governance"
              value={`${state.governance.votingPeriodDays}d · ${state.governance.quorumPct}% quorum · ${state.governance.proposalThresholdPct}% threshold`}
            />
          )}
        </div>
      </div>

      <div className={styles.calldataSection}>
        <p className={styles.calldataLabel}>Calldata preview</p>
        <p className={styles.calldataNote}>
          Stub — real ABI-encoded calldata populates once WS-1 lands.
        </p>
        <pre className={styles.calldataPre}>{calldataPreview}</pre>
      </div>

      <div className={styles.ctaSection}>
        <Button
          variant="primary"
          disabled
          title="WS-1 (role encoder) + WS-9 (IPFS) must land first"
        >
          Create company
        </Button>
        <p className={styles.ctaNote}>Available once WS-1 + WS-9 are merged.</p>
      </div>
    </WizardPanel>
  );
}

interface ReviewRowProps {
  label: string;
  value: string;
}

function ReviewRow({ label, value }: ReviewRowProps) {
  return (
    <div className={styles.reviewRow}>
      <span className={styles.reviewLabel}>{label}</span>
      <span className={styles.reviewValue}>{value}</span>
    </div>
  );
}
