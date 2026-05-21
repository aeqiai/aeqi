/**
 * Quorum surface — table-row proposer cell with hover reputation
 * preview. Extracted from `QuorumPage.proposals-section.tsx` so the
 * iter-8 hover affordance doesn't push that file past the 600-line
 * lint cap.
 *
 * Renders nothing extra when the proposer has only one proposal on
 * this TRUST (the cell stays a plain CopyableMono): the popover would
 * just say "1 proposal · pending" which doesn't earn its weight. The
 * tone glyph + popover mirror the detail-modal reputation glyph so
 * an operator sees a consistent reputation story between table and
 * modal.
 */
import { useMemo } from "react";

import type { ProposalWithPda } from "@/solana";
import { Popover, Stack } from "@/components/ui";
import { CopyableMono } from "./QuorumPage.parts";
import { shortAddress } from "./QuorumPage.format";
import {
  computeProposerReputation,
  recentProposalsBy,
  reputationToneForGlyph,
} from "./QuorumPage.reputation";
import styles from "./QuorumPage.module.css";

export function ProposerCellHover({
  proposerB58,
  proposals,
  nowSeconds,
}: {
  proposerB58: string;
  proposals: ProposalWithPda[];
  nowSeconds: number;
}) {
  const reputation = useMemo(
    () => computeProposerReputation(proposerB58, proposals, nowSeconds),
    [proposerB58, proposals, nowSeconds],
  );
  const recent = useMemo(
    () => recentProposalsBy(proposerB58, proposals, nowSeconds, 5),
    [proposerB58, proposals, nowSeconds],
  );
  const display = shortAddress(proposerB58);
  const hasPreview = reputation.total > 1;
  const glyphTone = reputationToneForGlyph(reputation);
  // Stop the trigger from bubbling clicks up to the surrounding table
  // row click handler — otherwise opening the hover popover would also
  // open the proposal detail modal.
  const trigger = (
    <span
      className={styles.proposerCell}
      onClick={(e) => {
        if (hasPreview) e.stopPropagation();
      }}
      role={hasPreview ? "button" : undefined}
      tabIndex={hasPreview ? 0 : undefined}
    >
      <CopyableMono full={proposerB58} display={display} />
      {hasPreview && glyphTone ? (
        <span className={styles.proposerHoverDot} data-tone={glyphTone} aria-hidden="true" />
      ) : null}
    </span>
  );
  if (!hasPreview) return trigger;
  const headline =
    reputation.successRate === null
      ? `${reputation.total} proposals · none settled yet`
      : `${reputation.total} proposals · ${Math.round(reputation.successRate * 100)}% success`;
  return (
    <Popover trigger={trigger} placement="bottom-start">
      <Stack gap="2" className={styles.proposerHoverPanel}>
        <span className={styles.proposerHoverHeading}>{headline}</span>
        {recent.length === 0 ? (
          <span className={styles.proposerHoverFootnote}>
            No earlier proposals from this proposer.
          </span>
        ) : (
          <div role="list">
            {recent.map((p) => (
              <div key={p.id} className={styles.proposerHoverRow} role="listitem">
                <span className={styles.proposerHoverDot} data-tone={p.tone} aria-hidden="true" />
                <span className={styles.proposerHoverId} title={p.id}>
                  {p.idShort}
                </span>
                <span className={styles.proposerHoverStatus} data-tone={p.tone}>
                  {p.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </Stack>
    </Popover>
  );
}
