/**
 * CapTableImportModal — iter-11 functional gap.
 *
 * Bulk-issue or redistribute cap-table shares from a pasted CSV.
 *
 * Two modes share the same parse + preview pipeline:
 *   - Mint:     each row hits `api.tokenMint` (creates new tokens).
 *               Company-authority gated server-side; non-owners see a 403.
 *   - Transfer: each row hits `api.tokenTransfer` (moves tokens from the
 *               caller's own ATA — implicit "treasury source" being the
 *               company authority's holdings). The brief calls this
 *               "Transfer from custody"; honest scope: the platform's
 *               token-transfer endpoint only knows about caller-owned
 *               ATAs, so the "source holder picker" is implicit. A
 *               follow-up endpoint can extend this to per-holder
 *               authority-delegated transfers if/when the protocol
 *               supports it.
 *
 * CSV grammar:
 *   - Header optional. First line is treated as a header when both
 *     fields are non-numeric (e.g. `recipient,amount`).
 *   - Lines: `recipient_pubkey,amount` (whitespace around either side
 *     trimmed). Comments (`#`) and blank lines skipped.
 *   - Amount is a decimal token quantity (e.g. `1000` or `100.5`) — same
 *     decimal scale as `EquityShareControls` (`TOKEN_DECIMALS = 6`).
 *
 * Per-row validation runs before any chain call fires:
 *   - Pubkey shape (32–44 base58 chars).
 *   - Positive numeric amount.
 *   - Decimal precision ≤ TOKEN_DECIMALS.
 *
 * Execution is sequential (one ix at a time) — keeps the operator's
 * mental model simple ("row N succeeded / failed") and matches how the
 * existing platform endpoints serialize requests through the same
 * company authority. Per-row status renders inline so the import progress
 * is visible row-by-row instead of as a single spinner.
 */
import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { Badge, Button, Modal, Select, Table, Textarea, type TableColumn } from "@/components/ui";

import "./CapTableImportModal.css";

const TOKEN_DECIMALS = 6;
const TOKEN_DECIMAL_POW = 10 ** TOKEN_DECIMALS;

export interface CapTableImportModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  /**
   * Fired after every row settles (success OR failure). The parent can
   * use this to refresh the cap-table reads via React Query
   * invalidation; not currently wired since the equity reads carry a
   * 30s staleTime and the operator can refresh manually.
   */
  onSettled?: () => void;
}

type ImportMode = "mint" | "transfer";

interface ParsedRow {
  /** 1-indexed CSV line, useful for error attribution. */
  line: number;
  /** Raw text as pasted; surfaced when parse fails. */
  raw: string;
  /** Trimmed recipient pubkey. */
  recipient: string;
  /** Display string (e.g. "1,000.50"). */
  amountDisplay: string;
  /** Amount in base units. `null` when parse failed. */
  amountBaseUnits: number | null;
  /** Per-row validation error, or null when the row is clean. */
  error: string | null;
}

type RowStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; signature: string }
  | { kind: "failed"; message: string };

const isBase58Pubkey = (s: string) =>
  s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);

/**
 * Parse a decimal token amount into base units. Returns null when the
 * string is malformed, negative, zero, or has more than `TOKEN_DECIMALS`
 * fractional digits.
 */
function toBaseUnits(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > TOKEN_DECIMALS) return null;
  const wholeUnits = Number(whole) * TOKEN_DECIMAL_POW;
  const fracPadded = frac.padEnd(TOKEN_DECIMALS, "0");
  const fracUnits = Number(fracPadded);
  if (!Number.isFinite(wholeUnits) || !Number.isFinite(fracUnits)) return null;
  const total = wholeUnits + fracUnits;
  if (total <= 0 || !Number.isSafeInteger(total)) return null;
  return total;
}

/**
 * Tokenize a CSV line into `[recipient, amount]`. Strips a leading
 * `#`-comment line and skips blanks. The first line is dropped when
 * neither column parses as a number — that's how we sniff a header row
 * without forcing operators to use one.
 */
function splitCsv(input: string): { header: string | null; rows: { line: number; raw: string }[] } {
  const lines = input.split(/\r?\n/);
  let header: string | null = null;
  const out: { line: number; raw: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    // Header sniff — only on the first non-blank line.
    if (out.length === 0 && header === null) {
      const cols = trimmed.split(",").map((s) => s.trim());
      if (cols.length >= 2 && toBaseUnits(cols[1]) === null && !isBase58Pubkey(cols[0])) {
        header = trimmed;
        continue;
      }
    }
    out.push({ line: i + 1, raw });
  }
  return { header, rows: out };
}

function parseRow(raw: string, line: number): ParsedRow {
  const cols = raw.split(",").map((s) => s.trim());
  const recipient = cols[0] ?? "";
  const amountDisplay = cols[1] ?? "";
  let error: string | null = null;
  if (cols.length < 2) {
    error = "Row needs `recipient,amount`";
  } else if (!isBase58Pubkey(recipient)) {
    error = "Recipient is not a valid base58 pubkey";
  }
  const amountBaseUnits = toBaseUnits(amountDisplay);
  if (error === null && amountBaseUnits === null) {
    error = `Amount "${amountDisplay}" is not a positive number with ≤ ${TOKEN_DECIMALS} decimals`;
  }
  return {
    line,
    raw,
    recipient,
    amountDisplay,
    amountBaseUnits,
    error,
  };
}

interface PreviewRow {
  row: ParsedRow;
  status: RowStatus;
}

/**
 * Column definitions for the preview Table. Declared at module scope so
 * the reference is stable — Table primitive memoizes against the
 * columns array and re-deriving it inside the modal component would
 * thrash the cache on every keystroke in the CSV textarea.
 */
const importPreviewColumns: Array<TableColumn<PreviewRow>> = [
  {
    key: "line",
    header: "Line",
    width: "56px",
    cell: (entry) => <span className="cap-table-import__lineCell">{entry.row.line}</span>,
  },
  {
    key: "recipient",
    header: "Recipient",
    cell: (entry) => (
      <span
        className={
          entry.row.error
            ? "cap-table-import__recipient cap-table-import__recipient--error"
            : "cap-table-import__recipient"
        }
        title={entry.row.recipient}
      >
        {entry.row.recipient.length > 0
          ? `${entry.row.recipient.slice(0, 6)}…${entry.row.recipient.slice(-4)}`
          : "—"}
      </span>
    ),
  },
  {
    key: "amount",
    header: "Amount",
    align: "end",
    cell: (entry) => (
      <span className="cap-table-import__amountCell">{entry.row.amountDisplay || "—"}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (entry) => {
      const { row, status } = entry;
      if (row.error) {
        return <span className="cap-table-import__rowError">{row.error}</span>;
      }
      if (status.kind === "submitting") {
        return (
          <Badge variant="info" size="sm">
            submitting…
          </Badge>
        );
      }
      if (status.kind === "success") {
        return (
          <span className="cap-table-import__rowSuccess" title={status.signature}>
            ✓ {status.signature.slice(0, 6)}…{status.signature.slice(-4)}
          </span>
        );
      }
      if (status.kind === "failed") {
        return (
          <span className="cap-table-import__rowFailed" title={status.message}>
            ✗ {status.message}
          </span>
        );
      }
      return (
        <Badge variant="muted" size="sm">
          ready
        </Badge>
      );
    },
  },
];

export function CapTableImportModal({
  open,
  onClose,
  companyId,
  onSettled,
}: CapTableImportModalProps) {
  const [mode, setMode] = useState<ImportMode>("mint");
  const [csv, setCsv] = useState("");
  const [statuses, setStatuses] = useState<RowStatus[]>([]);
  const [running, setRunning] = useState(false);

  const { rows, parsed } = useMemo(() => {
    const { rows: csvRows } = splitCsv(csv);
    const parsedRows = csvRows.map((r) => parseRow(r.raw, r.line));
    return { rows: csvRows, parsed: parsedRows };
  }, [csv]);

  const validCount = parsed.filter((r) => r.error === null).length;
  const errorCount = parsed.length - validCount;

  const handleClose = () => {
    if (running) return;
    // Reset state when the operator dismisses — the next open is a
    // fresh import, not a continuation.
    setCsv("");
    setStatuses([]);
    setMode("mint");
    onClose();
  };

  const handleImport = async () => {
    if (validCount === 0 || running) return;
    setRunning(true);
    // Seed status array — one slot per parsed row. Rows with parse
    // errors stay "idle" forever (we skip them in the loop) so the UI
    // can render the error inline without juggling two arrays.
    const initial: RowStatus[] = parsed.map((r) => (r.error ? { kind: "idle" } : { kind: "idle" }));
    setStatuses(initial);
    for (let i = 0; i < parsed.length; i += 1) {
      const row = parsed[i];
      if (row.error !== null || row.amountBaseUnits === null) continue;
      setStatuses((s) => {
        const next = [...s];
        next[i] = { kind: "submitting" };
        return next;
      });
      try {
        const res =
          mode === "mint"
            ? await api.tokenMint({
                entity_id: companyId,
                recipient_pubkey: row.recipient,
                amount: row.amountBaseUnits,
              })
            : await api.tokenTransfer({
                entity_id: companyId,
                recipient_pubkey: row.recipient,
                amount: row.amountBaseUnits,
              });
        setStatuses((s) => {
          const next = [...s];
          next[i] = { kind: "success", signature: res.signature_b58 };
          return next;
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Request failed";
        setStatuses((s) => {
          const next = [...s];
          next[i] = { kind: "failed", message };
          return next;
        });
      }
    }
    setRunning(false);
    onSettled?.();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Import cap-table CSV">
      <div className="cap-table-import">
        <div className="cap-table-import__modeRow">
          <label className="cap-table-import__modeLabel" htmlFor="cap-table-import-mode">
            Mode
          </label>
          <Select
            id="cap-table-import-mode"
            value={mode}
            disabled={running}
            onChange={(next) => setMode(next as ImportMode)}
            options={[
              {
                value: "mint",
                label: "Mint — issue new shares from company authority",
              },
              {
                value: "transfer",
                label: "Transfer from custody — redistribute from company authority ATA",
              },
            ]}
          />
          <p className="cap-table-import__modeHelp">
            {mode === "mint"
              ? "Each row mints fresh shares to the recipient. Supply grows; company authority signs."
              : "Each row moves existing shares from the company authority's ATA to the recipient. Supply unchanged."}
          </p>
        </div>
        <div className="cap-table-import__csvRow">
          <label className="cap-table-import__csvLabel" htmlFor="cap-table-import-csv">
            CSV — one `recipient,amount` per line
          </label>
          <Textarea
            id="cap-table-import-csv"
            bare
            className="cap-table-import__csvInput"
            placeholder={`recipient,amount\n3Dv...abc,1000\n5Yk...xyz,500`}
            value={csv}
            disabled={running}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
          />
          <div className="cap-table-import__csvSummary">
            {rows.length === 0 ? (
              <span className="cap-table-import__hint">
                Paste rows above. Header line and `#` comments are optional.
              </span>
            ) : (
              <span className="cap-table-import__counts">
                <Badge variant="muted" size="sm">
                  {parsed.length} rows
                </Badge>
                <Badge variant={errorCount === 0 ? "success" : "warning"} size="sm">
                  {validCount} valid
                </Badge>
                {errorCount > 0 && (
                  <Badge variant="error" size="sm">
                    {errorCount} with errors
                  </Badge>
                )}
              </span>
            )}
          </div>
        </div>
        {parsed.length > 0 && (
          <div className="cap-table-import__preview">
            <Table
              ariaLabel="Cap-table import preview"
              data={parsed.map((row, idx) => ({
                row,
                status: statuses[idx] ?? ({ kind: "idle" } as RowStatus),
              }))}
              rowKey={(r) => `${r.row.line}-${r.row.raw}`}
              columns={importPreviewColumns}
              stickyHeader
            />
          </div>
        )}
        <div className="cap-table-import__footer">
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={running}>
            {running ? "Running…" : "Close"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={validCount === 0 || running}
          >
            {running
              ? "Importing…"
              : mode === "mint"
                ? `Mint ${validCount} row${validCount === 1 ? "" : "s"}`
                : `Transfer ${validCount} row${validCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
