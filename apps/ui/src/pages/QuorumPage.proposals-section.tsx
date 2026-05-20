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
 */
import { useEffect, useMemo, useState } from "react";

import { deriveProposalStatus } from "@/solana";
import type {
  GovernanceConfigWithPda,
  ProposalStatus,
  ProposalWithPda,
  RoleAccountWithPda,
  RoleTypeWithPda,
} from "@/solana";
import { Button, Inline, PageSection, Stack, Table, type TableColumn } from "@/components/ui";
import {
  CopyableMono,
  FilterChip,
  ModeBadge,
  ProposalStatusBadge,
  SnapshotIndicator,
  SortChip,
  TallyBars,
  bytesToHex,
  configIdLabel,
  shortAddress,
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

type SortKey = "recent" | "oldest" | "closingSoon" | "quorumProgress";
type FilterKey = "all" | "active" | "pending" | "succeeded" | "defeated" | "executed" | "canceled";

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
  const [filter, setFilter] = useState<FilterKey>("active");
  const [configFilter, setConfigFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("recent");
  const [detail, setDetail] = useState<{
    proposal: ProposalWithPda;
    status: ProposalStatus;
  } | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [comparePicks, setComparePicks] = useState<string[]>([]);

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
        <CopyableMono
          full={row.proposal.account.proposer.toBase58()}
          display={shortAddress(row.proposal.account.proposer.toBase58())}
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
      setCompareMode(false);
      setComparePicks([]);
    }
  }, [canCompare, compareMode]);

  const pickedProposals = useMemo(() => {
    return comparePicks
      .map((key) => rows.find((r) => r.proposal.publicKey.toBase58() === key))
      .filter((x): x is (typeof rows)[number] => x !== undefined);
  }, [comparePicks, rows]);

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
          {canCompare ? (
            <Button
              variant={compareMode ? "primary" : "ghost"}
              size="sm"
              onClick={() => {
                setCompareMode((m) => {
                  const next = !m;
                  if (!next) setComparePicks([]);
                  return next;
                });
              }}
              aria-pressed={compareMode}
              aria-label="Toggle proposal compare mode"
            >
              {compareMode ? `Comparing ${comparePicks.length}/2` : "Compare"}
            </Button>
          ) : null}
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
        <Table
          columns={columns}
          data={rows}
          rowKey={(row) => row.proposal.publicKey.toBase58()}
          onRowClick={compareMode ? undefined : (row) => setDetail(row)}
          empty={<ProposalsEmptyState filter={filter} />}
          ariaLabel="Governance proposals"
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
        trustId={trustId}
        trustAddress={trustAddress}
        nowSeconds={nowSeconds}
        viewerCreatorAddress={viewerCreatorAddress}
        onClose={() => setDetail(null)}
      />
    </PageSection>
  );
}
