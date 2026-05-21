/**
 * Quorum surface — `ProposalsSection`.
 *
 * Extracted from `QuorumPage.tsx` so the iter-5 compare mode + role
 * cancel allowlist wiring doesn&apos;t push the page entry past the
 * 600-line lint cap. Owns the proposals table, filter + sort + compare
 * toolbar, the per-row action column (View / Vote / Compare-Select), and
 * dispatches to ProposalDetailModal + ProposalCompareTray.
 *
 * Pure UI — no on-chain reads (parent does those via `useQuorum`), only
 * the live-clock interval that ticks the row countdowns forward.
 *
 * iter-6: filter / sort / configFilter / compareMode / comparePicks /
 * selected-proposal are now persisted into the URL search params so a
 * deep-linked compare or detail view survives a refresh. The serializer
 * uses short keys (`f`, `s`, `c`, `cmp`, `cmpPicks`, `proposal`) to keep
 * the URL readable. Bad params fall back to defaults silently — bookmark
 * URLs stay forgiving.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { deriveProposalStatus } from "@/solana";
import type {
  GovernanceConfigWithPda,
  ProposalStatus,
  ProposalWithPda,
  RoleAccountWithPda,
  RoleTypeWithPda,
} from "@/solana";
import { Button, Inline, PageSection, Stack, Table, type TableColumn } from "@/components/ui";
import { ProposerCellHover } from "./QuorumPage.proposer-cell";
import { CancelledDisclosure } from "./QuorumPage.cancelled-disclosure";
import { useTableRowHighlight } from "@/hooks/useTableRowHighlight";
import {
  FilterChip,
  ModeBadge,
  ProposalStatusBadge,
  SnapshotIndicator,
  SortChip,
  TallyBars,
  bytesToHex,
  configIdLabel,
  shortBytes32,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.parts";
import {
  InlineVoteActions,
  ProposalCompareTray,
  ProposalDetailModal,
  ProposalsEmptyState,
} from "./QuorumPage.write";
import { ShortcutsCheatSheet, useQuorumKeyboardShortcuts } from "./QuorumPage.shortcuts";
import styles from "./QuorumPage.module.css";

type SortKey = "recent" | "oldest" | "closingSoon" | "quorumProgress";
type FilterKey = "all" | "active" | "pending" | "succeeded" | "defeated" | "executed" | "canceled";

const FILTER_VALUES: ReadonlySet<FilterKey> = new Set<FilterKey>([
  "all",
  "active",
  "pending",
  "succeeded",
  "defeated",
  "executed",
  "canceled",
]);
const SORT_VALUES: ReadonlySet<SortKey> = new Set<SortKey>([
  "recent",
  "oldest",
  "closingSoon",
  "quorumProgress",
]);
const DEFAULT_FILTER: FilterKey = "active";
const DEFAULT_SORT: SortKey = "recent";

export function ProposalsSection({
  proposals,
  configs,
  roleTypes,
  roles,
  trustId,
  trustAddress,
  viewerCreatorAddress,
}: {
  proposals: ProposalWithPda[];
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  /**
   * Occupied role accounts on this TRUST. Forwarded down to the proposal
   * action bar so the cancel CTA can extend beyond the TRUST creator EOA
   * to anyone holding a role on the TRUST. Empty array when no roles
   * are registered (Foundation-shaped TRUSTs).
   */
  roles: RoleAccountWithPda[];
  trustId: string;
  trustAddress: string;
  /** EOA that owns this TRUST. Used to gate the Cancel proposal CTA. */
  viewerCreatorAddress: string | null;
}) {
  // URL-persisted view state. We read params on every render (cheap;
  // `useSearchParams` returns the same `URLSearchParams` reference until
  // navigation), validate against the closed sets, and fall back silently
  // when a bookmark carries stale or hand-crafted values. Writes go
  // through `patchParams` so we only mutate the keys we own and leave
  // unrelated params (q, view, etc. shared with the sibling primitives)
  // untouched.
  const [searchParams, setSearchParams] = useSearchParams();
  const patchParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      mut(next);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const filterRaw = searchParams.get("f");
  const filter: FilterKey = FILTER_VALUES.has(filterRaw as FilterKey)
    ? (filterRaw as FilterKey)
    : DEFAULT_FILTER;
  const setFilter = useCallback(
    (next: FilterKey) => {
      patchParams((p) => {
        if (next === DEFAULT_FILTER) p.delete("f");
        else p.set("f", next);
      });
    },
    [patchParams],
  );

  const configFilterRaw = searchParams.get("c");
  // Only honor a config-filter param that matches a registered config —
  // otherwise the chip row would show no `active` chip and the operator
  // would see a stale filter they can't clear via the UI.
  const configFilter = useMemo(() => {
    if (!configFilterRaw) return null;
    const normalized = configFilterRaw.toLowerCase().startsWith("0x")
      ? configFilterRaw.toLowerCase()
      : `0x${configFilterRaw.toLowerCase()}`;
    const ok = configs.some(
      (cfg) => `0x${bytesToHex(cfg.account.governanceConfigId)}` === normalized,
    );
    return ok ? normalized : null;
  }, [configFilterRaw, configs]);
  const setConfigFilter = useCallback(
    (next: string | null) => {
      patchParams((p) => {
        if (next === null) p.delete("c");
        else p.set("c", next);
      });
    },
    [patchParams],
  );

  const sortRaw = searchParams.get("s");
  const sort: SortKey = SORT_VALUES.has(sortRaw as SortKey) ? (sortRaw as SortKey) : DEFAULT_SORT;
  const setSort = useCallback(
    (next: SortKey) => {
      patchParams((p) => {
        if (next === DEFAULT_SORT) p.delete("s");
        else p.set("s", next);
      });
    },
    [patchParams],
  );

  // Compare mode is bound to the URL too — a deep-linked active
  // comparison survives refresh. Picks are a comma-separated list of
  // proposal PDA b58 strings, capped at 2 entries to match the UX cap.
  const compareMode = searchParams.get("cmp") === "1";
  const setCompareMode = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      patchParams((p) => {
        const prev = p.get("cmp") === "1";
        const resolved = typeof next === "function" ? next(prev) : next;
        if (resolved) p.set("cmp", "1");
        else {
          p.delete("cmp");
          p.delete("cmpPicks");
        }
      });
    },
    [patchParams],
  );

  const comparePicksRaw = searchParams.get("cmpPicks");
  const comparePicks = useMemo(() => {
    if (!comparePicksRaw) return [] as string[];
    return comparePicksRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 2);
  }, [comparePicksRaw]);
  const setComparePicks = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      patchParams((p) => {
        const prev = (p.get("cmpPicks") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 2);
        const resolved = typeof next === "function" ? next(prev) : next;
        const capped = resolved.slice(0, 2);
        if (capped.length === 0) p.delete("cmpPicks");
        else p.set("cmpPicks", capped.join(","));
      });
    },
    [patchParams],
  );

  // Selected-proposal detail modal — also URL-persisted so a refresh
  // reopens the same proposal. We store the proposal PDA b58 because
  // it's the stable on-chain identifier; the section resolves the live
  // entry by walking `proposals` on each render.
  const selectedPda = searchParams.get("proposal");
  const detail = useMemo(() => {
    if (!selectedPda) return null;
    const match = proposals.find((p) => p.publicKey.toBase58() === selectedPda);
    if (!match) return null;
    // The status derives from the same live clock used by the row, so
    // recomputing here keeps the modal's countdown synced even after a
    // refresh-driven nowSeconds reset.
    return {
      proposal: match,
      status: deriveProposalStatus(match.account, Math.floor(Date.now() / 1000)),
    };
  }, [selectedPda, proposals]);
  const setDetail = useCallback(
    (next: { proposal: ProposalWithPda; status: ProposalStatus } | null) => {
      patchParams((p) => {
        if (next === null) p.delete("proposal");
        else p.set("proposal", next.proposal.publicKey.toBase58());
      });
    },
    [patchParams],
  );

  // iter-7: keyboard-driven row selection. The selected row index is
  // local state (not URL-persisted — selection is ephemeral and
  // deep-linking it would compete with `?proposal=` for the same
  // "what's focused" signal). `↑ / ↓` move the index, `v` opens detail
  // on the highlighted row, `c` toggles compare mode.
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Re-tick once per minute so active-row countdowns drift forward
  // visibly. 60s is the cheapest cadence that still feels live for a
  // multi-hour or multi-day vote window; sub-minute updates would burn
  // renders without an operator-visible change.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const withStatus = useMemo(
    () =>
      proposals.map((p) => ({
        proposal: p,
        status: deriveProposalStatus(p.account, nowSeconds),
      })),
    [proposals, nowSeconds],
  );

  const filtered = useMemo(() => {
    return withStatus.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (configFilter !== null) {
        const hex = `0x${bytesToHex(p.proposal.account.governanceConfigId)}`;
        if (hex !== configFilter) return false;
      }
      return true;
    });
  }, [withStatus, filter, configFilter]);

  const rows = useMemo(() => {
    const arr = [...filtered];
    const recent = (a: (typeof arr)[number], b: (typeof arr)[number]) =>
      Number(b.proposal.account.voteStart.toString()) -
      Number(a.proposal.account.voteStart.toString());

    const endsAt = (entry: (typeof arr)[number]) => {
      const { end } = voteWindowSeconds(entry.proposal.account);
      return typeof end === "number" ? end : Number.POSITIVE_INFINITY;
    };

    const quorumProgress = (entry: (typeof arr)[number]) => {
      const acc = entry.proposal.account;
      const total =
        BigInt(acc.forVotes.toString()) +
        BigInt(acc.againstVotes.toString()) +
        BigInt(acc.abstainVotes.toString());
      if (total === 0n) return 0;
      return Number((BigInt(acc.forVotes.toString()) * 1000n) / total) / 10;
    };

    if (sort === "oldest") {
      arr.sort((a, b) => -recent(a, b) || recent(a, b));
    } else if (sort === "closingSoon") {
      arr.sort((a, b) => endsAt(a) - endsAt(b) || recent(a, b));
    } else if (sort === "quorumProgress") {
      arr.sort((a, b) => quorumProgress(b) - quorumProgress(a) || recent(a, b));
    } else {
      arr.sort(recent);
    }
    return arr;
  }, [filtered, sort]);

  // iter-8: on `all`, hide canceled rows behind a disclosure (default
  // closed). URL `cn=1` preserves the open state across refresh.
  const cancelledOpenRaw = searchParams.get("cn") === "1";
  const setCancelledOpen = useCallback(
    (next: boolean) => {
      patchParams((p) => {
        if (next) p.set("cn", "1");
        else p.delete("cn");
      });
    },
    [patchParams],
  );
  const { visibleRows, cancelledRows } = useMemo(() => {
    if (filter !== "all") {
      return { visibleRows: rows, cancelledRows: [] as typeof rows };
    }
    const visible: typeof rows = [];
    const cancelled: typeof rows = [];
    for (const r of rows) {
      if (r.status === "canceled") cancelled.push(r);
      else visible.push(r);
    }
    return { visibleRows: visible, cancelledRows: cancelled };
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: 0,
      active: 0,
      pending: 0,
      succeeded: 0,
      defeated: 0,
      executed: 0,
      canceled: 0,
    };
    for (const { proposal, status } of withStatus) {
      if (configFilter !== null) {
        const hex = `0x${bytesToHex(proposal.account.governanceConfigId)}`;
        if (hex !== configFilter) continue;
      }
      c.all += 1;
      c[status] += 1;
    }
    return c;
  }, [withStatus, configFilter]);

  const columns: Array<TableColumn<(typeof rows)[number]>> = [
    {
      key: "id",
      header: "Proposal",
      cell: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          {shortBytes32(row.proposal.account.proposalId)}
        </span>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      cell: (row) => (
        <ModeBadge configId={row.proposal.account.governanceConfigId} roleTypes={roleTypes} />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const { start, end } = voteWindowSeconds(row.proposal.account);
        return (
          <ProposalStatusBadge
            status={row.status}
            nowSeconds={nowSeconds}
            voteStart={start ?? undefined}
            voteEnd={end ?? undefined}
          />
        );
      },
    },
    {
      key: "tallies",
      header: "Tallies",
      cell: (row) => <TallyBars proposal={row.proposal.account} />,
    },
    {
      key: "window",
      header: "Vote window",
      cell: (row) => (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
          {voteWindowLabel(row.proposal.account)}
        </span>
      ),
    },
    {
      key: "snapshot",
      header: "Snapshot",
      cell: (row) => <SnapshotIndicator proposal={row.proposal.account} />,
    },
    {
      key: "proposer",
      header: "Proposer",
      cell: (row) => (
        <ProposerCellHover
          proposerB58={row.proposal.account.proposer.toBase58()}
          proposals={proposals}
          nowSeconds={nowSeconds}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      cell: (row) => {
        const proposalIdHex = `0x${bytesToHex(row.proposal.account.proposalId)}`;
        const pdaKey = row.proposal.publicKey.toBase58();
        const isPicked = comparePicks.includes(pdaKey);
        const pickDisabled = !isPicked && comparePicks.length >= 2;
        const togglePick = (e: React.SyntheticEvent) => {
          e.stopPropagation();
          setComparePicks((prev) => {
            if (prev.includes(pdaKey)) return prev.filter((k) => k !== pdaKey);
            if (prev.length >= 2) return prev;
            return [...prev, pdaKey];
          });
        };
        return (
          <Inline gap="2">
            {compareMode && row.status === "active" ? (
              <Button
                variant={isPicked ? "primary" : "ghost"}
                size="sm"
                onClick={togglePick}
                disabled={pickDisabled}
                aria-pressed={isPicked}
                aria-label={
                  isPicked
                    ? `Remove proposal ${shortBytes32(row.proposal.account.proposalId)} from compare`
                    : `Add proposal ${shortBytes32(row.proposal.account.proposalId)} to compare`
                }
              >
                {isPicked ? "Selected" : "Select"}
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetail(row);
                  }}
                  aria-label={`View proposal ${shortBytes32(row.proposal.account.proposalId)}`}
                >
                  View
                </Button>
                {row.status === "active" ? (
                  <InlineVoteActions
                    trustId={trustId}
                    trustAddress={trustAddress}
                    proposalIdHex={proposalIdHex}
                    proposalIdBytes={row.proposal.account.proposalId}
                  />
                ) : null}
              </>
            )}
          </Inline>
        );
      },
    },
  ];

  // Compare mode is only useful when filter is `active` and at least two
  // active proposals are visible — otherwise the toggle is hidden.
  const activeCount = withStatus.filter((p) => p.status === "active").length;
  const canCompare = filter === "active" && activeCount >= 2;
  useEffect(() => {
    if (!canCompare && compareMode) {
      // Use a single patch — setCompareMode(false) already strips both
      // cmp and cmpPicks in one tick, avoiding the dual-write race
      // through React Router's setSearchParams.
      setCompareMode(false);
    }
  }, [canCompare, compareMode, setCompareMode]);

  const pickedProposals = useMemo(() => {
    return comparePicks
      .map((key) => rows.find((r) => r.proposal.publicKey.toBase58() === key))
      .filter((x): x is (typeof rows)[number] => x !== undefined);
  }, [comparePicks, rows]);

  // ── Keyboard shortcuts (iter-7) ──────────────────────────────────
  // Clamp the selected index whenever the visible rows shrink (filter
  // change, compare-mode pick removal, async refetch) — otherwise the
  // pointer can dangle past the end of the list and `v` would no-op.
  // iter-8: navigation operates on the visible primary table only.
  // Canceled rows in the disclosure don't participate in arrow nav.
  useEffect(() => {
    if (visibleRows.length === 0) {
      if (selectedIndex !== 0) setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= visibleRows.length) {
      setSelectedIndex(visibleRows.length - 1);
    }
  }, [visibleRows.length, selectedIndex]);

  const handleMoveSelection = useCallback(
    (delta: 1 | -1) => {
      if (visibleRows.length === 0) return;
      setSelectedIndex((prev) => {
        const next = prev + delta;
        if (next < 0) return 0;
        if (next >= visibleRows.length) return visibleRows.length - 1;
        return next;
      });
    },
    [visibleRows.length],
  );

  const handleViewSelected = useCallback(() => {
    const row = visibleRows[selectedIndex];
    if (!row) return;
    setDetail(row);
  }, [visibleRows, selectedIndex, setDetail]);

  const handleToggleCompare = useCallback(() => {
    if (!canCompare) return;
    setCompareMode((m) => !m);
  }, [canCompare, setCompareMode]);

  // Only bind shortcuts when the detail modal is closed — otherwise
  // `v` / arrows would fight the modal's own focus management.
  const shortcutsActive = detail === null;
  useQuorumKeyboardShortcuts({
    onToggleCompare: shortcutsActive && canCompare ? handleToggleCompare : undefined,
    onViewSelected: shortcutsActive && visibleRows.length > 0 ? handleViewSelected : undefined,
    onMoveSelection: shortcutsActive && visibleRows.length > 0 ? handleMoveSelection : undefined,
  });

  // Paint the highlight + scroll the selected row into view; logic
  // extracted so this file stays under the 600-line lint cap.
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedKey = visibleRows[selectedIndex]?.proposal.publicKey.toBase58() ?? null;
  useTableRowHighlight(tableWrapperRef, selectedKey, [visibleRows]);

  return (
    <PageSection
      title="Proposals"
      description="Every proposal opened against this TRUST. Status derives from tallies + the cluster clock."
    >
      <Stack gap="3">
        {configs.length > 1 ? (
          <Inline gap="2" wrap aria-label="Filter by voting config">
            <FilterChip
              label="All configs"
              count={withStatus.length}
              active={configFilter === null}
              onClick={() => setConfigFilter(null)}
            />
            {configs.map((cfg) => {
              const hex = `0x${bytesToHex(cfg.account.governanceConfigId)}`;
              const count = withStatus.filter(
                (p) => `0x${bytesToHex(p.proposal.account.governanceConfigId)}` === hex,
              ).length;
              return (
                <FilterChip
                  key={hex}
                  label={configIdLabel(cfg.account.governanceConfigId, roleTypes)}
                  count={count}
                  active={configFilter === hex}
                  onClick={() => setConfigFilter(hex)}
                />
              );
            })}
          </Inline>
        ) : null}
        <Inline gap="2" wrap justify="between">
          <Inline gap="2" wrap>
            {(
              [
                ["active", "Active"],
                ["pending", "Pending"],
                ["succeeded", "Succeeded"],
                ["defeated", "Defeated"],
                ["executed", "Executed"],
                ["canceled", "Canceled"],
                ["all", "All"],
              ] as Array<[FilterKey, string]>
            ).map(([key, label]) => (
              <FilterChip
                key={key}
                label={label}
                count={counts[key]}
                active={filter === key}
                onClick={() => setFilter(key)}
              />
            ))}
          </Inline>
          <Inline gap="2" align="center">
            {canCompare ? (
              <Button
                variant={compareMode ? "primary" : "ghost"}
                size="sm"
                onClick={() => setCompareMode((m) => !m)}
                aria-pressed={compareMode}
                aria-label="Toggle proposal compare mode"
              >
                {compareMode ? `Comparing ${comparePicks.length}/2` : "Compare"}
              </Button>
            ) : null}
            <ShortcutsCheatSheet />
          </Inline>
        </Inline>
        {withStatus.length >= 5 ? (
          <Inline gap="2" wrap aria-label="Sort proposals">
            {(
              [
                ["recent", "Recent"],
                ["oldest", "Oldest"],
                ["closingSoon", "Closing soon"],
                ["quorumProgress", "Quorum progress"],
              ] as Array<[SortKey, string]>
            ).map(([key, label]) => (
              <SortChip
                key={key}
                label={label}
                active={sort === key}
                onClick={() => setSort(key)}
              />
            ))}
          </Inline>
        ) : null}
        <div ref={tableWrapperRef} className={styles.proposalsTableWrap}>
          <Table
            columns={columns}
            data={visibleRows}
            rowKey={(row) => row.proposal.publicKey.toBase58()}
            onRowClick={
              compareMode
                ? undefined
                : (row, index) => {
                    setSelectedIndex(index);
                    setDetail(row);
                  }
            }
            empty={<ProposalsEmptyState filter={filter} />}
            ariaLabel="Governance proposals"
          />
        </div>
        <CancelledDisclosure
          rows={cancelledRows}
          columns={columns}
          open={cancelledOpenRaw}
          onToggle={() => setCancelledOpen(!cancelledOpenRaw)}
          onRowClick={compareMode ? undefined : (row) => setDetail(row)}
        />
        {compareMode ? (
          <ProposalCompareTray
            picks={pickedProposals}
            configs={configs}
            roleTypes={roleTypes}
            nowSeconds={nowSeconds}
            onClear={() => setComparePicks([])}
          />
        ) : null}
      </Stack>
      <ProposalDetailModal
        entry={detail}
        configs={configs}
        roleTypes={roleTypes}
        roles={roles}
        proposals={proposals}
        trustId={trustId}
        trustAddress={trustAddress}
        nowSeconds={nowSeconds}
        viewerCreatorAddress={viewerCreatorAddress}
        onClose={() => setDetail(null)}
      />
    </PageSection>
  );
}

// `ProposerCellHover` moved to `./QuorumPage.proposer-cell.tsx`.
