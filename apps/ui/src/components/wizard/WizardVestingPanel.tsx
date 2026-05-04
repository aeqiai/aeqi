import { Select } from "@/components/ui";
import { WizardPanel } from "./WizardPanel";
import styles from "./WizardVestingPanel.module.css";

export interface VestingSchedule {
  roleType: string;
  durationYears: string;
  cliffMonths: string;
}

export interface VestingState {
  schedules: VestingSchedule[];
}

interface WizardVestingPanelProps {
  state: VestingState;
  onChange: (next: VestingState) => void;
  expanded: boolean;
  onToggle: () => void;
}

const DURATION_OPTIONS = [
  { value: "1", label: "1 year" },
  { value: "2", label: "2 years" },
  { value: "3", label: "3 years" },
  { value: "4", label: "4 years" },
];

const CLIFF_OPTIONS = [
  { value: "0", label: "No cliff" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "1 year" },
];

/**
 * Vesting panel — per-roleType vesting schedules.
 *
 * Defaults: Founder = 4yr / 1yr cliff, Director = same, Worker = 2yr / 6mo cliff.
 * Only renders when the blueprint has a Vesting module.
 */
export function WizardVestingPanel({
  state,
  onChange,
  expanded,
  onToggle,
}: WizardVestingPanelProps) {
  const summary = state.schedules
    .map((s) => `${s.roleType} ${s.durationYears}yr/${s.cliffMonths}mo`)
    .join(", ");

  function updateSchedule(idx: number, partial: Partial<VestingSchedule>) {
    const next = state.schedules.map((s, i) => (i === idx ? { ...s, ...partial } : s));
    onChange({ schedules: next });
  }

  return (
    <WizardPanel
      id="wizard-vesting"
      title="Vesting"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className={styles.scheduleList}>
        {state.schedules.map((schedule, idx) => (
          <div key={schedule.roleType} className={styles.scheduleRow}>
            <span className={styles.roleType}>{schedule.roleType}</span>
            <div className={styles.fields}>
              <Select
                options={DURATION_OPTIONS}
                value={schedule.durationYears}
                onChange={(v) => updateSchedule(idx, { durationYears: v })}
                size="sm"
              />
              <span className={styles.separator}>cliff</span>
              <Select
                options={CLIFF_OPTIONS}
                value={schedule.cliffMonths}
                onChange={(v) => updateSchedule(idx, { cliffMonths: v })}
                size="sm"
              />
            </div>
          </div>
        ))}
      </div>
    </WizardPanel>
  );
}
