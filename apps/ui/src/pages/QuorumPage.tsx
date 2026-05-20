import { useEffect, useMemo, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useQuorum } from "@/hooks/useQuorum";
import { deriveProposalStatus, isTokenModeId } from "@/solana";
import type {
  GovernanceConfigWithPda,
  ProposalStatus,
  ProposalWithPda,
  RoleTypeWithPda,
} from "@/solana";
import {
  Button,
  EmptyState,
  Inline,
  Loading,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Stack,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";
import {
  CopyableMono,
  FilterChip,
  KpiStrip,
  ModeBadge,
  NoGovernanceSetup,
  ProposalStatusBadge,
  SnapshotIndicator,
  TallyBars,
  bpsLabel,
  configIdLabel,
  durationLabel,
  modeLabel,
  shortAddress,
  shortBytes32,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.parts";
import {
  InlineVoteActions,
  NewProposalModal,
  ProposalDetailModal,
  ProposalsEmptyState,
} from "./QuorumPage.write";
import { bytesToHex } from "./QuorumPage.format";

/**
 * Quorum — `q` in the AEQI grammar (assets · equity · quorum · identity).
 *
 * Read-only first ship of the governance surface. Renders the TRUST's
 * registered voting configs (token-mode and/or per-role-mode) plus
 * every proposal that has ever been created against this TRUST. Reads
 * go DIRECT from the browser through the shared Anchor provider; the
 * write paths (propose / vote / execute / register_config) are owned
 * by a sibling follow-up quest and surface here only as "(coming
 * soon)" placeholders so users know where they will land.
 *
 * Sections:
 *   1. Voting configs — table of every GovernanceConfig PDA scoped to
 *      this TRUST, with a per-row mode badge (Token-weighted vs
 *      Role:<type>) plus the quorum / support thresholds and the
 *      voting-period window.
 *   2. Proposals — table of every Proposal PDA scoped to this TRUST,
 *      with a mode badge, derived status (active / executed / canceled
 *      / succeeded / defeated / pending), for/against/abstain bars,
 *      the vote window, and a snapshot-root commit indicator for
 *      token-mode proposals (matrix §3.5).
 *   3. Filter chips above the Proposals table — All / Active /
 *      Executed / Canceled. Default Active.
 *
 * Anti-scope: no proposal create, no vote cast, no execute, no signer
 * rotation, no snapshot_root commit, no new design tokens. All defer
 * to follow-up quests.
 */
export default function QuorumPage({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = useMemo(() => entities.find((e) => e.id === trustId), [entities, trustId]);
  const trustAddress = entity?.trust_address ?? null;

  const { configs, proposals, roleTypes, isLoading, error } = useQuorum(trustAddress);
  const [newProposalOpen, setNewProposalOpen] = useState(false);

  // ── Pre-bridge state: entity exists but has no on-chain mirror yet.
  if (!trustAddress) {
    return (
      <Page>
        <PageHeader title="Governance" description="How the TRUST decides — proposals + votes." />
        <PageBody>
          <EmptyState
            title="Not yet on-chain"
            description="This entity does not have a TRUST proxy address yet. Once the click-to-DAO bridge fires, voting configs and proposals will render here."
          />
        </PageBody>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="Governance" description="How the TRUST decides — proposals + votes." />
        <PageBody>
          <Loading variant="section" label="Reading on-chain governance state" />
        </PageBody>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageHeader title="Governance" description="How the TRUST decides — proposals + votes." />
        <PageBody>
          <EmptyState
            title="Couldn't read governance state"
            description={error.message || "The RPC call to the configured Solana cluster failed."}
          />
        </PageBody>
      </Page>
    );
  }

  const configsList = configs ?? [];
  const proposalsList = proposals ?? [];
  const roleTypeList = roleTypes ?? [];

  // Foundation TRUSTs register `aeqi_governance` as a module but most
  // signup flows never register a voting config — render an explicit
  // empty state so the user knows the surface is wired correctly.
  const hasAnything = configsList.length > 0 || proposalsList.length > 0;

  // The "+ New proposal" CTA in the page header only makes sense once
  // at least one voting config exists. Before that, the empty-state
  // card owns the "set up governance" affordance.
  const headerActions =
    hasAnything && configsList.length > 0 ? (
      <Button variant="primary" size="sm" onClick={() => setNewProposalOpen(true)}>
        + New proposal
      </Button>
    ) : undefined;

  return (
    <Page>
      <PageHeader
        title="Governance"
        description="How the TRUST decides — proposals + votes."
        actions={headerActions}
      />
      <PageBody>
        {!hasAnything ? (
          <NoGovernanceSetup trustId={trustId} />
        ) : (
          <>
            <KpiStrip proposals={proposalsList} configs={configsList} />
            <ConfigsSection configs={configsList} roleTypes={roleTypeList} />
            <ProposalsSection
              proposals={proposalsList}
              configs={configsList}
              roleTypes={roleTypeList}
              trustId={trustId}
              trustAddress={trustAddress}
            />
          </>
        )}
      </PageBody>
      <NewProposalModal
        open={newProposalOpen}
        trustId={trustId}
        configs={configsList}
        roleTypes={roleTypeList}
        onClose={() => setNewProposalOpen(false)}
      />
    </Page>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Sections                                                            */
/* ────────────────────────────────────────────────────────────────── */

function ConfigsSection({
  configs,
  roleTypes,
}: {
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
}) {
  const rows = useMemo(
    () =>
      [...configs].sort((a, b) => {
        // Token-mode config (all-zero id) sorts first; rest by role label.
        const aToken = isTokenModeId(a.account.governanceConfigId);
        const bToken = isTokenModeId(b.account.governanceConfigId);
        if (aToken && !bToken) return -1;
        if (!aToken && bToken) return 1;
        return modeLabel(a.account.governanceConfigId, roleTypes).localeCompare(
          modeLabel(b.account.governanceConfigId, roleTypes),
        );
      }),
    [configs, roleTypes],
  );

  const columns: Array<TableColumn<GovernanceConfigWithPda>> = [
    {
      key: "mode",
      header: "Mode",
      cell: (row) => <ModeBadge configId={row.account.governanceConfigId} roleTypes={roleTypes} />,
    },
    {
      key: "configId",
      header: "Config ID",
      cell: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          {configIdLabel(row.account.governanceConfigId, roleTypes)}
        </span>
      ),
    },
    {
      key: "quorum",
      header: "Quorum",
      align: "end",
      cell: (row) => (
        <Tooltip content="Minimum participation required for a proposal to be executable, in basis points (10000 = 100%).">
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {bpsLabel(row.account.quorumBps)}
          </span>
        </Tooltip>
      ),
    },
    {
      key: "support",
      header: "Support",
      align: "end",
      cell: (row) => (
        <Tooltip content="Share of cast votes that must vote `for` for the proposal to succeed.">
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {bpsLabel(row.account.supportBps)}
          </span>
        </Tooltip>
      ),
    },
    {
      key: "votingPeriod",
      header: "Voting period",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {durationLabel(row.account.votingPeriod)}
        </span>
      ),
    },
  ];

  return (
    <PageSection
      title="Voting configs"
      description="Each config defines a voting mode and thresholds. Token-mode is the default for cap-table votes; role-mode is per-role multisig."
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        empty={
          <EmptyState
            title="No voting configs registered"
            description="Proposals can't be opened until at least one voting config is registered."
          />
        }
        ariaLabel="Registered voting configs"
      />
    </PageSection>
  );
}

type FilterKey = "all" | "active" | "pending" | "succeeded" | "defeated" | "executed" | "canceled";

function ProposalsSection({
  proposals,
  configs,
  roleTypes,
  trustId,
  trustAddress,
}: {
  proposals: ProposalWithPda[];
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  trustId: string;
  trustAddress: string;
}) {
  const [filter, setFilter] = useState<FilterKey>("active");
  const [detail, setDetail] = useState<{
    proposal: ProposalWithPda;
    status: ProposalStatus;
  } | null>(null);

  // Re-tick once per minute so active-row countdowns drift forward
  // visibly. 60s is the cheapest cadence that still feels live for a
  // multi-hour or multi-day vote window; sub-minute updates would
  // burn renders without an operator-visible change. The clock is
  // captured once per tick so all rows resolve against the same now.
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
    if (filter === "all") return withStatus;
    return withStatus.filter((p) => p.status === filter);
  }, [withStatus, filter]);

  // Newest first — Anchor returns `i64` as BN; use number compare on
  // voteStart which fits in JS safe-int range for any realistic clock.
  const rows = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          Number(b.proposal.account.voteStart.toString()) -
          Number(a.proposal.account.voteStart.toString()),
      ),
    [filtered],
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: withStatus.length,
      active: 0,
      pending: 0,
      succeeded: 0,
      defeated: 0,
      executed: 0,
      canceled: 0,
    };
    for (const { status } of withStatus) {
      // `status` is a ProposalStatus literal; every value except
      // `succeeded`/`defeated`/`canceled`/`executed`/`active`/`pending`
      // would be a type error so the index access is sound here.
      c[status] += 1;
    }
    return c;
  }, [withStatus]);

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
        return (
          <Inline gap="2">
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
              <InlineVoteActions trustId={trustId} proposalIdHex={proposalIdHex} />
            ) : null}
          </Inline>
        );
      },
    },
  ];

  return (
    <PageSection
      title="Proposals"
      description="Every proposal opened against this TRUST. Status derives from tallies + the cluster clock."
    >
      <Stack gap="3">
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
        <Table
          columns={columns}
          data={rows}
          rowKey={(row) => row.proposal.publicKey.toBase58()}
          onRowClick={(row) => setDetail(row)}
          empty={<ProposalsEmptyState filter={filter} />}
          ariaLabel="Governance proposals"
        />
      </Stack>
      <ProposalDetailModal
        entry={detail}
        configs={configs}
        roleTypes={roleTypes}
        trustAddress={trustAddress}
        nowSeconds={nowSeconds}
        onClose={() => setDetail(null)}
      />
    </PageSection>
  );
}
