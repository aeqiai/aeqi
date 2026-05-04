import { Input } from "@/components/ui";
import { WizardPanel } from "./WizardPanel";
import styles from "./WizardGovernancePanel.module.css";

export interface GovernanceState {
  votingPeriodDays: string;
  quorumPct: string;
  proposalThresholdPct: string;
}

interface WizardGovernancePanelProps {
  state: GovernanceState;
  onChange: (next: GovernanceState) => void;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Governance panel — voting period, quorum, proposal threshold.
 *
 * Defaults: 7 days / 50% quorum / 1% threshold.
 * Only renders when the blueprint has a Governance module.
 */
export function WizardGovernancePanel({
  state,
  onChange,
  expanded,
  onToggle,
}: WizardGovernancePanelProps) {
  const summary = `${state.votingPeriodDays}d · ${state.quorumPct}% quorum · ${state.proposalThresholdPct}% threshold`;

  return (
    <WizardPanel
      id="wizard-governance"
      title="Governance"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className={styles.fields}>
        <Input
          label="Voting period (days)"
          value={state.votingPeriodDays}
          onChange={(e) =>
            onChange({ ...state, votingPeriodDays: e.target.value.replace(/[^0-9]/g, "") })
          }
          placeholder="7"
          hint="How long a proposal stays open for votes."
        />
        <Input
          label="Quorum (%)"
          value={state.quorumPct}
          onChange={(e) => onChange({ ...state, quorumPct: e.target.value.replace(/[^0-9]/g, "") })}
          placeholder="50"
          hint="Minimum participation for a vote to count."
        />
        <Input
          label="Proposal threshold (%)"
          value={state.proposalThresholdPct}
          onChange={(e) =>
            onChange({ ...state, proposalThresholdPct: e.target.value.replace(/[^0-9]/g, "") })
          }
          placeholder="1"
          hint="Token share required to submit a proposal."
        />
      </div>
    </WizardPanel>
  );
}
