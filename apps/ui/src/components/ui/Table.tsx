import { forwardRef, type ReactNode, type KeyboardEvent } from "react";
import styles from "./Table.module.css";

export interface TableColumn<T> {
  /** Stable key for React reconciliation. */
  key: string;
  /** Header label. */
  header: ReactNode;
  /** Cell renderer. Receives the row and its index. */
  cell: (row: T, index: number) => ReactNode;
  /**
   * Column width as a `<col>` width value. Examples: `"40%"`, `"160px"`,
   * `"1fr"` (browsers treat `fr` on `<col>` as auto). Omit to let the
   * browser distribute remaining space.
   */
  width?: string;
  /** Cell text alignment. Default `"start"`. */
  align?: "start" | "end" | "center";
  /** Extra class for both the header and body cells of this column. */
  className?: string;
}

export interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  data: T[];
  /** Stable row id. */
  rowKey: (row: T, index: number) => string;
  /** Make rows clickable (Enter / Space activate the row). */
  onRowClick?: (row: T, index: number) => void;
  /** Density. `"comfortable"` (default) or `"compact"`. */
  density?: "comfortable" | "compact";
  /** Hide the header row. Default `false`. */
  hideHeader?: boolean;
  /** Empty state when `data.length === 0`. */
  empty?: ReactNode;
  /** ARIA label for the table. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Table — Notion-minimal data table primitive.
 *
 * Real `<table>` semantics so columns align, screen readers announce
 * structure, and tabular numerics line up. No hairlines (per design
 * system) — separation is by spacing + tint on hover. One canonical
 * answer for every list view in the app.
 *
 * Example:
 *
 *   <Table
 *     columns={[
 *       { key: "title", header: "Title", cell: (r) => r.title },
 *       { key: "date", header: "Created", cell: (r) => r.created_at, width: "120px", align: "end" },
 *     ]}
 *     data={rows}
 *     rowKey={(r) => r.id}
 *     onRowClick={onSelect}
 *   />
 */
function TableInner<T>(
  {
    columns,
    data,
    rowKey,
    onRowClick,
    density = "comfortable",
    hideHeader = false,
    empty,
    ariaLabel,
    className,
  }: TableProps<T>,
  ref: React.Ref<HTMLTableElement>,
) {
  const cls = [styles.table, styles[density], className].filter(Boolean).join(" ");

  if (data.length === 0 && empty !== undefined) {
    return <div className={styles.emptyWrap}>{empty}</div>;
  }

  return (
    <table ref={ref} className={cls} aria-label={ariaLabel}>
      <colgroup>
        {columns.map((col) => (
          <col key={col.key} style={col.width ? { width: col.width } : undefined} />
        ))}
      </colgroup>
      {!hideHeader && (
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                data-align={col.align ?? "start"}
                className={col.className}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {data.map((row, i) => {
          const clickable = !!onRowClick;
          const handleClick = clickable ? () => onRowClick!(row, i) : undefined;
          const handleKeyDown = clickable
            ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick!(row, i);
                }
              }
            : undefined;
          return (
            <tr
              key={rowKey(row, i)}
              className={clickable ? styles.rowClickable : undefined}
              onClick={handleClick}
              onKeyDown={handleKeyDown}
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? "button" : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} data-align={col.align ?? "start"} className={col.className}>
                  {col.cell(row, i)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const Table = forwardRef(TableInner) as <T>(
  props: TableProps<T> & { ref?: React.Ref<HTMLTableElement> },
) => ReturnType<typeof TableInner>;
