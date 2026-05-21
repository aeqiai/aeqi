/**
 * Quorum surface — print-ready vote receipt + on-chain verifier panel.
 *
 * Extracted from `QuorumPage.write.tsx` so that file stays under the
 * 600-line lint cap as iter-7 grew the receipt with a "Verify on
 * Solana" section spelling out the on-chain PDA seeds and explorer URL
 * a third party would need to reconstruct the cast.
 *
 * The receipt itself is captured at cast-time inside
 * `InlineVoteActions` and rendered here — never persisted to local
 * storage because the canonical record is the on-chain VoteRecord PDA.
 * The modal is a pure render of the in-memory struct + a print button.
 */
import { Button, Inline, Modal } from "@/components/ui";
import styles from "./QuorumPage.module.css";
import { formatTimestamp } from "./QuorumPage.format";
import { explorerAddressUrl, explorerClusterLabel } from "@/lib/solana-explorer";

/**
 * Self-contained receipt data captured at cast-time. Lives entirely on
 * the success branch of `InlineVoteActions` — never persisted to local
 * storage because the canonical record is the on-chain VoteRecord PDA.
 * The modal is a render of this struct.
 */
export interface VoteReceipt {
  trustAddress: string;
  proposalIdHex: string;
  choice: 0 | 1 | 2;
  weight: string;
  signature: string;
  voteRecordPubkey: string;
  castAtUnix: number;
}

const CHOICE_LABEL_FOR_RECEIPT: Record<0 | 1 | 2, "For" | "Against" | "Abstain"> = {
  0: "Against",
  1: "For",
  2: "Abstain",
};

const CHOICE_TONE_FOR_RECEIPT: Record<0 | 1 | 2, "for" | "against" | "abstain"> = {
  0: "against",
  1: "for",
  2: "abstain",
};

/**
 * Print-ready vote receipt. Opens as a Modal but the inner card carries
 * its own self-contained layout + print-friendly styles in the CSS
 * module so the operator can hit "Print" and get a clean single-page
 * artifact — what a CFO would slip into a board folder.
 *
 * iter-7: the closing paragraph is now a structured "Verify on Solana"
 * panel that spells out the explorer URL, the on-chain PDA seed tuple,
 * and the cast_vote ix trace — giving a verifier the exact recipe to
 * reconstruct the receipt from the chain without re-deriving it.
 *
 * No external network calls; everything renders from the in-memory
 * receipt struct captured at cast-time.
 */
export function VoteReceiptModal({
  open,
  receipt,
  onClose,
}: {
  open: boolean;
  receipt: VoteReceipt;
  onClose: () => void;
}) {
  const choiceLabel = CHOICE_LABEL_FOR_RECEIPT[receipt.choice];
  const choiceTone = CHOICE_TONE_FOR_RECEIPT[receipt.choice];
  const castAtLabel = formatTimestamp(receipt.castAtUnix);
  const handlePrint = () => {
    // window.print() is the cheapest print path that doesn't require
    // popping a new tab. The @media print rules in the css module strip
    // the modal chrome so only `.receiptCard` reaches the page.
    window.print();
  };
  const explorerHref = explorerAddressUrl(receipt.voteRecordPubkey);
  return (
    <Modal open={open} onClose={onClose} title="Vote receipt">
      <div className={`${styles.scope} ${styles.modalBody} ${styles.receiptModal}`}>
        <div className={styles.receiptCard} role="document" aria-label="Vote receipt">
          <div className={styles.receiptHeader}>
            <span className={styles.receiptKicker}>aeqi · vote receipt</span>
            <h2 className={styles.receiptTitle}>
              {choiceLabel} · weight {receipt.weight}
            </h2>
          </div>
          <div className={styles.receiptGrid}>
            <span className={styles.receiptGridLabel}>Vote</span>
            <span
              className={`${styles.receiptGridValue} ${styles.receiptChoice}`}
              data-tone={choiceTone}
            >
              {choiceLabel}
            </span>
            <span className={styles.receiptGridLabel}>Weight</span>
            <span className={styles.receiptGridValue}>{receipt.weight}</span>
            <span className={styles.receiptGridLabel}>TRUST</span>
            <span className={styles.receiptGridValue}>{receipt.trustAddress}</span>
            <span className={styles.receiptGridLabel}>Proposal ID</span>
            <span className={styles.receiptGridValue}>{receipt.proposalIdHex}</span>
            <span className={styles.receiptGridLabel}>Vote record</span>
            <span className={styles.receiptGridValue}>{receipt.voteRecordPubkey}</span>
            <span className={styles.receiptGridLabel}>Signature</span>
            <span className={styles.receiptGridValue}>{receipt.signature}</span>
            <span className={styles.receiptGridLabel}>Cast at</span>
            <span className={styles.receiptGridValue}>
              {castAtLabel} · unix {receipt.castAtUnix}
            </span>
          </div>
          <p className={styles.receiptVerifier}>
            This receipt is print-friendly. The canonical record is the on-chain VoteRecord PDA at
            the address above — anyone can reconstruct it from the seeds below and confirm the
            choice + weight match what this paper says.
          </p>
          <div className={styles.receiptVerifierPanel}>
            <h3 className={styles.receiptVerifierHeading}>Verify on Solana</h3>
            <ol className={styles.receiptVerifierList}>
              <li>
                Open the VoteRecord on a block explorer:{" "}
                <a
                  href={explorerHref}
                  className={styles.receiptVerifierLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {explorerHref}
                </a>{" "}
                <span className={styles.receiptVerifierSeed}>
                  cluster: {explorerClusterLabel()}
                </span>
              </li>
              <li>
                Confirm the account is owned by the <code>aeqi_governance</code> program and decodes
                as a <code>VoteRecord</code> with{" "}
                <span className={styles.receiptVerifierSeed}>choice = {receipt.choice}</span> and{" "}
                <span className={styles.receiptVerifierSeed}>weight = {receipt.weight}</span>.
              </li>
              <li>
                Reconstruct the PDA from the seed tuple{" "}
                <span className={styles.receiptVerifierSeed}>
                  [b&quot;vote&quot;, trust, proposal_id, voter]
                </span>{" "}
                under <code>aeqi_governance</code>. The trust pubkey is{" "}
                <span className={styles.receiptVerifierSeed}>{receipt.trustAddress}</span> and the
                proposal_id is the 32-byte payload above.
              </li>
              <li>
                Trace the cast_vote ix via the transaction signature{" "}
                <span className={styles.receiptVerifierSeed}>{receipt.signature}</span> — its
                <code> instructions[*]</code> array contains the cast_vote call that allocated this
                PDA.
              </li>
            </ol>
          </div>
        </div>
        <Inline gap="2" justify="end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="sm" onClick={handlePrint} aria-label="Print receipt">
            Print
          </Button>
        </Inline>
      </div>
    </Modal>
  );
}
