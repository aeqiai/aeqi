import { forwardRef, useMemo, useState, type ReactNode, type KeyboardEvent } from "react";
import styles from "./Table.module.css";

export type TableSortDir = "asc" | "desc";
export type TableScrollWidth = "none" | "sm" | "md" | "lg";

export interface TableSort {
  key: string;
  dir: TableSortDir;
}

export interface TableColumn<T> {
  /** Stable key for React reconciliation. Also the value passed to `sort.key`. */
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
  /** Make this column's header clickable to sort. Requires `sortAccessor`. */
  sortable?: boolean;
  /**
   * Comparable value extracted from a row for sort. Strings compared
   * locale-aware (case-insensitive); numbers / dates compared numerically.
   * Required when `sortable` is `true`. `null`/`undefined` sort to the end.
   */
  sortAccessor?: (row: T) => string | number | Date | null | undefined;
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
  /** Render canonical table skeleton rows instead of page-local placeholders. */
  loading?: boolean;
  /** Number of skeleton body rows rendered while `loading` is true. */
  skeletonRows?: number;
  /** Accessible loading label announced through a visually hidden caption. */
  loadingLabel?: string;
  /**
   * Horizontal scroll width for dense operational tables.
   * `sm` = 720px, `md` = 960px, `lg` = 1200px.
   */
  scrollWidth?: TableScrollWidth;
  /** Keep column labels visible when the table scrolls vertically inside a surface. */
  stickyHeader?: boolean;
  /** ARIA label for the table. */
  ariaLabel?: string;
  className?: string;
  /**
   * Initial uncontrolled sort. Header clicks cycle asc → desc → cleared,
   * starting from this state.
   */
  defaultSort?: TableSort | null;
  /** Controlled sort. When set, `defaultSort` is ignored. */
  sort?: TableSort | null;
  /** Fires on header click. Receives `null` when sort is cleared. */
  onSortChange?: (next: TableSort | null) => void;
}

/**
 * Table — Notion-minimal data table primitive with column-header sort.
 *
 * Real `<table>` semantics so columns align, screen readers announce
 * structure, and tabular numerics line up. No hairlines (per design
 * system) — separation is by spacing + tint on hover. Click any column
 * marked `sortable` to cycle asc → desc → cleared.
 *
 * Operational tables can opt into canonical overflow + loading:
 *
 *   <Table
 *     columns={columns}
 *     data={rows}
 *     rowKey={(r) => r.id}
 *     loading={isLoading}
 *     skeletonRows={5}
 *     scrollWidth="lg"
 *   />
 *
 * Example:
 *
 *   <Table
 *     columns={[
 *       { key: "title", header: "Title", cell: (r) => r.title,
 *         sortable: true, sortAccessor: (r) => r.title },
 *       { key: "date",  header: "Created", cell: (r) => r.created_at,
 *         width: "120px", align: "end",
 *         sortable: true, sortAccessor: (r) => r.created_at },
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
    loading = false,
    skeletonRows = 3,
    loadingLabel = "Loading table rows",
    scrollWidth = "none",
    stickyHeader = false,
    ariaLabel,
    className,
    defaultSort = null,
    sort: sortProp,
    onSortChange,
  }: TableProps<T>,
  ref: React.Ref<HTMLTableElement>,
) {
  const [internalSort, setInternalSort] = useState<TableSort | null>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : internalSort;

  const setSort = (next: TableSort | null) => {
    if (sortProp === undefined) setInternalSort(next);
    onSortChange?.(next);
  };

  const handleHeaderClick = (col: TableColumn<T>) => {
    if (!col.sortable || !col.sortAccessor) return;
    if (!sort || sort.key !== col.key) {
      setSort({ key: col.key, dir: "asc" });
    } else if (sort.dir === "asc") {
      setSort({ key: col.key, dir: "desc" });
    } else {
      setSort(null);
    }
  };

  const handleHeaderKeyDown = (e: KeyboardEvent<HTMLTableCellElement>, col: TableColumn<T>) => {
    if (!col.sortable || !col.sortAccessor) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleHeaderClick(col);
    }
  };

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortAccessor) return data;
    const accessor = col.sortAccessor;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      // null / undefined sort to the end regardless of direction
      const aNull = va === null || va === undefined;
      const bNull = vb === null || vb === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb, undefined, { sensitivity: "base" }) * dir;
      }
      const na = va instanceof Date ? va.getTime() : (va as number);
      const nb = vb instanceof Date ? vb.getTime() : (vb as number);
      if (na < nb) return -1 * dir;
      if (na > nb) return 1 * dir;
      return 0;
    });
  }, [data, sort, columns]);

  const cls = [styles.table, styles[density], className].filter(Boolean).join(" ");

  if (!loading && data.length === 0 && empty !== undefined) {
    return <div className={styles.emptyWrap}>{empty}</div>;
  }

  return (
    <div
      className={styles.viewport}
      data-scroll-width={scrollWidth}
      data-sticky-header={stickyHeader ? "true" : undefined}
    >
      <table ref={ref} className={cls} aria-label={ariaLabel} aria-busy={loading || undefined}>
        {loading && <caption className={styles.srOnly}>{loadingLabel}</caption>}
        <colgroup>
          {columns.map((col) => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        {!hideHeader && (
          <thead>
            <tr>
              {columns.map((col) => {
                const isSortable = !!col.sortable && !!col.sortAccessor;
                const ariaSort = !isSortable
                  ? undefined
                  : sort?.key === col.key
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                const headerCls = [col.className, isSortable ? styles.headerSortable : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <th
                    key={col.key}
                    scope="col"
                    data-align={col.align ?? "start"}
                    className={headerCls}
                    aria-sort={ariaSort}
                    onClick={isSortable ? () => handleHeaderClick(col) : undefined}
                    onKeyDown={isSortable ? (e) => handleHeaderKeyDown(e, col) : undefined}
                    tabIndex={isSortable ? 0 : undefined}
                  >
                    <span className={styles.headerInner}>
                      <span className={styles.headerLabel}>{col.header}</span>
                      {isSortable && (
                        <span className={styles.sortIndicator} aria-hidden>
                          {sort?.key === col.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
        )}
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                  {columns.map((col, colIndex) => (
                    <td key={col.key} data-align={col.align ?? "start"} className={col.className}>
                      <span
                        className={styles.skeletonBar}
                        data-size={SKELETON_SIZES[(rowIndex + colIndex) % SKELETON_SIZES.length]}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : sortedData.map((row, i) => {
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
                const key = rowKey(row, i);
                return (
                  <tr
                    key={key}
                    data-row-key={key}
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
    </div>
  );
}

export const Table = forwardRef(TableInner) as <T>(
  props: TableProps<T> & { ref?: React.Ref<HTMLTableElement> },
) => ReturnType<typeof TableInner>;

const SKELETON_SIZES = ["sm", "md", "lg", "xl"] as const;
