/**
 * Quorum surface — cancelled-proposals collapsible disclosure.
 *
 * Iter-8: when the proposals table is on the `all` filter, canceled rows
 * used to mix into the main scan and dilute the "what's live right now"
 * read. We split them out into a disclosure that defaults closed and
 * URL-persists its open/closed state via `cn=1`.
 *
 * Kept in its own file so the proposals-section stays under the 600-line
 * lint cap. The component is a pure renderer — the parent already
 * computed which rows are canceled and owns the open/closed state.
 */
import type { ProposalStatus, ProposalWithPda } from "@/solana";
import { Button, Table, type TableColumn } from "@/components/ui";
import styles from "./QuorumPage.module.css";

type Row = { proposal: ProposalWithPda; status: ProposalStatus };

export function CancelledDisclosure({
  rows,
  columns,
  open,
  onToggle,
  onRowClick,
}: {
  rows: Row[];
  columns: Array<TableColumn<Row>>;
  open: boolean;
  onToggle: () => void;
  onRowClick: ((row: Row) => void) | undefined;
}) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.cancelledDisclosure}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        aria-expanded={open}
        className={styles.cancelledToggle}
      >
        <span className={styles.cancelledToggleGlyph} aria-hidden="true" />
        {open ? "Hide cancelled" : "Show cancelled"}
        <span className={styles.cancelledToggleCount}>· {rows.length}</span>
      </Button>
      {open ? (
        <Table
          columns={columns}
          data={rows}
          rowKey={(row) => row.proposal.publicKey.toBase58()}
          onRowClick={onRowClick ? (row) => onRowClick(row) : undefined}
          ariaLabel="Cancelled proposals"
        />
      ) : null}
    </div>
  );
}
