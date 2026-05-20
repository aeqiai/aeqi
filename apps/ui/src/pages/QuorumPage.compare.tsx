/**
 * Quorum surface — proposal compare tray.
 *
 * Iter-5 functional carry: when the operator pivots to the `active`
 * filter and at least two proposals are live, the toolbar exposes a
 * `Compare` toggle. Toggling it swaps the row "View" affordance for a
 * `Select` button; picking up to two rows renders this tray side-by-side
 * below the table. Tally bars stack so a glance reads which proposal is
 * winning on `for` share and which is closer to closing the window.
 *
 * Pure presentation — no writes, no on-chain reads. All inputs are
 * already loaded by `useQuorum` and walked by the parent section.
 */
import type {
  GovernanceConfigWithPda,
  ProposalStatus,
  ProposalWithPda,
  RoleTypeWithPda,
} from "@/solana";
import { Button, Inline, Stack } from "@/components/ui";
import { ModeBadge, ProposalStatusBadge, TallyDetail, CopyableMono } from "./QuorumPage.parts";
import {
  bytesToHex,
  shortAddress,
  shortBytes32,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.format";
import styles from "./QuorumPage.module.css";

export interface ComparePick {
  proposal: ProposalWithPda;
  status: ProposalStatus;
}

/**
 * Side-by-side comparison surface. The tray renders three rails:
 *
 *   - Two columns of summary + tallies, one per picked proposal.
 *   - A "Pick more" prompt when the operator has selected fewer than 2.
 *
 * Configs are looked up by proposalId so each column can render the
 * canonical threshold markers on its TallyDetail. RoleTypes resolve the
 * mode badge label for role-mode proposals.
 */
export function ProposalCompareTray({
  picks,
  configs,
  roleTypes,
  nowSeconds,
  onClear,
}: {
  picks: ComparePick[];
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  nowSeconds: number;
  onClear: () => void;
}) {
  if (picks.length === 0) {
    return (
      <div className={`${styles.scope} ${styles.compareTray}`} data-empty="true">
        <span className={styles.compareEmptyTitle}>Pick two proposals to compare</span>
        <span className={styles.compareEmptyBody}>
          Compare mode is on. Hit <strong>Select</strong> on any two active rows above to stack
          their tallies side-by-side.
        </span>
      </div>
    );
  }

  return (
    <div className={`${styles.scope} ${styles.compareTray}`}>
      <Inline gap="2" justify="between" align="center">
        <span className={styles.compareTrayTitle}>Compare · {picks.length}/2 selected</span>
        <Button variant="ghost" size="sm" onClick={onClear} aria-label="Clear compare selection">
          Clear
        </Button>
      </Inline>
      <div className={styles.compareGrid} data-cols={picks.length}>
        {picks.map(({ proposal, status }) => {
          const acct = proposal.account;
          const matchedConfig = configs.find((c) =>
            bytesEqual(c.account.governanceConfigId, acct.governanceConfigId),
          );
          const { start, end } = voteWindowSeconds(acct);
          return (
            <Stack key={proposal.publicKey.toBase58()} gap="3" className={styles.compareColumn}>
              <div className={styles.compareHeader}>
                <CopyableMono
                  full={`0x${bytesToHex(acct.proposalId)}`}
                  display={shortBytes32(acct.proposalId)}
                />
                <ModeBadge configId={acct.governanceConfigId} roleTypes={roleTypes} />
              </div>
              <ProposalStatusBadge
                status={status}
                nowSeconds={nowSeconds}
                voteStart={start ?? undefined}
                voteEnd={end ?? undefined}
              />
              <span className={styles.compareWindow}>{voteWindowLabel(acct)}</span>
              <div>
                <h4 className={styles.compareSectionTitle}>Tallies</h4>
                <TallyDetail proposal={acct} config={matchedConfig} />
              </div>
              <div className={styles.compareFooter}>
                <span className={styles.compareFooterLabel}>Proposer</span>
                <CopyableMono
                  full={acct.proposer.toBase58()}
                  display={shortAddress(acct.proposer.toBase58())}
                />
              </div>
            </Stack>
          );
        })}
      </div>
    </div>
  );
}

/** Byte-equality across the two array-like shapes Anchor returns. */
function bytesEqual(a: Uint8Array | number[], b: Uint8Array | number[]): boolean {
  const aa = a instanceof Uint8Array ? a : Uint8Array.from(a);
  const bb = b instanceof Uint8Array ? b : Uint8Array.from(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}
