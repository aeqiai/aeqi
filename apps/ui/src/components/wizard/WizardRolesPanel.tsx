import { useState } from "react";
import type { Blueprint } from "@/lib/types";
import { Input, Select } from "@/components/ui";
import { WizardPanel } from "./WizardPanel";
import styles from "./WizardRolesPanel.module.css";

export interface RoleSeat {
  key: string;
  title: string;
  roleType: "founder" | "director" | "worker";
  /** "agent:<name>" | "user:<id>" | "vacant" */
  occupant: string;
  /** address shown as placeholder; null for agent seats */
  addressPlaceholder: string | null;
}

export interface InviteRow {
  email: string;
  roleType: "director" | "advisor";
}

interface WizardRolesPanelProps {
  blueprint: Blueprint;
  userId: string | null;
  userName: string;
  seats: RoleSeat[];
  invites: InviteRow[];
  onSeatsChange: (next: RoleSeat[]) => void;
  onInvitesChange: (next: InviteRow[]) => void;
  expanded: boolean;
  onToggle: () => void;
  /** True for personal-os: single owner row, no invite flow */
  personalOs: boolean;
}

const ROLE_TYPE_OPTIONS = [
  { value: "director", label: "Director" },
  { value: "advisor", label: "Advisor" },
];

/**
 * Roles panel — lists all seats from the blueprint, auto-populated.
 *
 * Founder/Director seats show the user's name. Agent seats show the agent name.
 * EOA address placeholder: "0x... — provisioned at create".
 * Hover-+ at the list footer adds an invite row (stub, no submit logic).
 */
export function WizardRolesPanel({
  userId,
  userName,
  seats,
  invites,
  onSeatsChange: _onSeatsChange,
  onInvitesChange,
  expanded,
  onToggle,
  personalOs,
}: WizardRolesPanelProps) {
  const [hoveringAdd, setHoveringAdd] = useState(false);

  const summary = `${seats.length} seat${seats.length !== 1 ? "s" : ""}`;

  function addInviteRow() {
    onInvitesChange([...invites, { email: "", roleType: "director" }]);
  }

  function updateInvite(idx: number, partial: Partial<InviteRow>) {
    const next = invites.map((row, i) => (i === idx ? { ...row, ...partial } : row));
    onInvitesChange(next);
  }

  function removeInvite(idx: number) {
    onInvitesChange(invites.filter((_, i) => i !== idx));
  }

  return (
    <WizardPanel
      id="wizard-roles"
      title="Roles"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className={styles.seatList}>
        {seats.map((seat) => (
          <SeatRow key={seat.key} seat={seat} userId={userId} userName={userName} />
        ))}

        {!personalOs &&
          invites.map((inv, idx) => (
            <InviteRowItem
              key={idx}
              invite={inv}
              onChange={(partial) => updateInvite(idx, partial)}
              onRemove={() => removeInvite(idx)}
            />
          ))}

        {!personalOs && (
          <button
            type="button"
            className={styles.addRow}
            onMouseEnter={() => setHoveringAdd(true)}
            onMouseLeave={() => setHoveringAdd(false)}
            onClick={addInviteRow}
          >
            <span className={styles.addIcon} aria-hidden="true">
              {hoveringAdd ? "+" : "+"}
            </span>
            <span className={styles.addLabel}>Invite co-director</span>
          </button>
        )}
      </div>
    </WizardPanel>
  );
}

interface SeatRowProps {
  seat: RoleSeat;
  userId: string | null;
  userName: string;
}

function SeatRow({ seat, userId: _userId, userName }: SeatRowProps) {
  const isHumanSeat = seat.occupant.startsWith("user:");
  const isAgentSeat = seat.occupant.startsWith("agent:");
  const agentName = isAgentSeat ? seat.occupant.slice(6) : null;

  return (
    <div className={styles.seatRow}>
      <div className={styles.seatLeft}>
        <span className={styles.seatTitle}>{seat.title}</span>
        <span className={styles.seatType}>{seat.roleType}</span>
      </div>
      <div className={styles.seatOccupant}>
        {isHumanSeat ? (
          <>
            <span className={styles.occupantName}>{userName}</span>
            <span className={styles.occupantAddr}>0x... — provisioned at create</span>
          </>
        ) : isAgentSeat ? (
          <span className={styles.occupantAgent}>{agentName}</span>
        ) : (
          <span className={styles.occupantVacant}>Vacant</span>
        )}
      </div>
    </div>
  );
}

interface InviteRowItemProps {
  invite: InviteRow;
  onChange: (partial: Partial<InviteRow>) => void;
  onRemove: () => void;
}

function InviteRowItem({ invite, onChange, onRemove }: InviteRowItemProps) {
  return (
    <div className={styles.inviteRow}>
      <div className={styles.inviteFields}>
        <Input
          placeholder="colleague@example.com"
          value={invite.email}
          onChange={(e) => onChange({ email: e.target.value })}
          size="sm"
        />
        <Select
          options={ROLE_TYPE_OPTIONS}
          value={invite.roleType}
          onChange={(v) => onChange({ roleType: v as "director" | "advisor" })}
          size="sm"
        />
      </div>
      <button
        type="button"
        className={styles.removeInvite}
        onClick={onRemove}
        aria-label="Remove invite"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 2L10 10M10 2L2 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
