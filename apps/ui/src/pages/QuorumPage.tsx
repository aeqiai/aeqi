import { useMemo, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useQuorum } from "@/hooks/useQuorum";
import { deriveProposalStatus, isTokenModeId } from "@/solana";
import type { GovernanceConfigWithPda, ProposalWithPda, RoleTypeWithPda } from "@/solana";
import {
  Badge,
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
  ModeBadge,
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
} from "./QuorumPage.parts";

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

  return (
    <Page>
      <PageHeader title="Governance" description="How the TRUST decides — proposals + votes." />
      <PageBody>
        {!hasAnything ? (
          <PageSection title="Voting configs">
            <EmptyState
              title="No voting configs yet"
              description="Once governance is configured, proposals appear here. The aeqi_governance module is registered on this TRUST but no voting config has been written yet."
            />
          </PageSection>
        ) : (
          <>
            <ConfigsSection configs={configsList} roleTypes={roleTypeList} />
            <ProposalsSection proposals={proposalsList} roleTypes={roleTypeList} />
          </>
        )}
      </PageBody>
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

type FilterKey = "all" | "active" | "executed" | "canceled";

function ProposalsSection({
  proposals,
  roleTypes,
}: {
  proposals: ProposalWithPda[];
  roleTypes: RoleTypeWithPda[];
}) {
  const [filter, setFilter] = useState<FilterKey>("active");

  // Compute "now" once per render so all rows derive status against
  // the same wall clock — a row that was "active" in the table can't
  // flip to "succeeded" on adjacent cells purely from a clock drift.
  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), []);

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
    if (filter === "active") return withStatus.filter((p) => p.status === "active");
    if (filter === "executed") return withStatus.filter((p) => p.status === "executed");
    if (filter === "canceled") return withStatus.filter((p) => p.status === "canceled");
    return withStatus;
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
    const c = { all: withStatus.length, active: 0, executed: 0, canceled: 0 };
    for (const { status } of withStatus) {
      if (status === "active") c.active += 1;
      else if (status === "executed") c.executed += 1;
      else if (status === "canceled") c.canceled += 1;
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
      cell: (row) => <ProposalStatusBadge status={row.status} />,
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
      cell: () => (
        <Tooltip content="Vote casting lands in a sibling follow-up ship.">
          <Badge variant="muted" size="sm">
            Vote (coming soon)
          </Badge>
        </Tooltip>
      ),
    },
  ];

  return (
    <PageSection
      title="Proposals"
      description="Every proposal opened against this TRUST. Status derives from tallies + the cluster clock."
    >
      <Stack gap="3">
        <Inline gap="2" wrap>
          <FilterChip
            label="Active"
            count={counts.active}
            active={filter === "active"}
            onClick={() => setFilter("active")}
          />
          <FilterChip
            label="All"
            count={counts.all}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterChip
            label="Executed"
            count={counts.executed}
            active={filter === "executed"}
            onClick={() => setFilter("executed")}
          />
          <FilterChip
            label="Canceled"
            count={counts.canceled}
            active={filter === "canceled"}
            onClick={() => setFilter("canceled")}
          />
        </Inline>
        <Table
          columns={columns}
          data={rows}
          rowKey={(row) => row.proposal.publicKey.toBase58()}
          empty={
            <EmptyState
              title={filter === "all" ? "No proposals yet" : `No ${filter} proposals`}
              description={
                filter === "all"
                  ? "When a proposal opens against this TRUST, it lands here."
                  : `No proposals are currently ${filter}. Switch the filter to see more.`
              }
            />
          }
          ariaLabel="Governance proposals"
        />
      </Stack>
    </PageSection>
  );
}
