import { useCallback, useMemo, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useQuorum } from "@/hooks/useQuorum";
import { useGovernanceSubscription } from "@/hooks/useGovernanceSubscription";
import { isTokenModeId } from "@/solana";
import type { GovernanceConfigWithPda, RoleTypeWithPda } from "@/solana";
import {
  Button,
  EmptyState,
  Loading,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";
import {
  KpiStrip,
  ModeBadge,
  NoGovernanceSetup,
  NoProposalsYetCard,
  ProgramNotProvisionedCard,
  bpsLabel,
  configIdLabel,
  durationLabel,
  modeLabel,
} from "./QuorumPage.parts";
import { NewProposalModal } from "./QuorumPage.write";
import { ProposalsSection } from "./QuorumPage.proposals-section";
import { ActivityTicker } from "./QuorumPage.ticker";
import { useQuorumKeyboardShortcuts } from "./QuorumPage.shortcuts";

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

  const { configs, proposals, roleTypes, roles, voteRecords, programDeployed, isLoading, error } =
    useQuorum(trustAddress);
  // iter-7: subscribe to `aeqi_governance` account changes for this TRUST
  // so a freshly-created proposal or cast vote appears without a manual
  // refresh. The hook is a no-op until the trust address resolves, so
  // it's safe to call ahead of the loading / error returns below.
  useGovernanceSubscription(trustAddress);
  const [newProposalOpen, setNewProposalOpen] = useState(false);

  // Hoisted ahead of the early returns so the hook order stays stable
  // across re-renders that flip between loading / error / data shapes.
  const openNewProposal = useCallback(() => setNewProposalOpen(true), []);
  // iter-7: bind `n` at the page level — opens the new-proposal modal
  // whenever the corresponding header CTA is visible (config exists,
  // modal not already open). Other bindings (`c` / `v` / arrows) live
  // inside `ProposalsSection` because they depend on row state owned
  // there. We guard the callback inside the hook to keep call order
  // stable; passing `undefined` for the binding is the disable signal.
  const configsLength = (configs ?? []).length;
  const shortcutOnNew = configsLength > 0 && !newProposalOpen ? openNewProposal : undefined;
  useQuorumKeyboardShortcuts({
    onNew: shortcutOnNew,
  });

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
  const rolesList = roles ?? [];
  const voteRecordsList = voteRecords ?? [];

  // Three distinct cohort empties, each with a different signal:
  //   1. Program not yet deployed on the active cluster — operator
  //      problem, surface as a deployment hint.
  //   2. Program deployed + no configs (Foundation default) — operator
  //      needs to register a voting config.
  //   3. Program deployed + configs but no proposals — operator should
  //      open the first one (CTA-led empty rather than the generic
  //      "nothing here yet").
  //
  // `programDeployed === undefined` means the probe is still in flight,
  // which the loading state above already caught.
  const programMissing = programDeployed === false;
  const hasConfigs = configsList.length > 0;
  const hasProposals = proposalsList.length > 0;

  // The "+ New proposal" CTA in the page header only makes sense once
  // at least one voting config exists. Before that, the empty-state
  // card owns the "set up governance" affordance. `openNewProposal` is
  // hoisted above the early returns so the page-level `n` shortcut hook
  // can use it without violating rules-of-hooks.
  const headerActions = hasConfigs ? (
    <Button variant="primary" size="sm" onClick={openNewProposal}>
      + New proposal
    </Button>
  ) : undefined;

  // The proposer-cancel check needs the EOA that owns this TRUST. We
  // resolve it once from the entity record so the action bar doesn't
  // re-derive on every render.
  const viewerCreatorAddress = entity?.creator_address ?? null;

  return (
    <Page>
      <PageHeader
        title="Governance"
        description="How the TRUST decides — proposals + votes."
        actions={headerActions}
      />
      <PageBody>
        {programMissing ? (
          <ProgramNotProvisionedCard />
        ) : !hasConfigs ? (
          <NoGovernanceSetup trustId={trustId} />
        ) : (
          <>
            <KpiStrip
              proposals={proposalsList}
              configs={configsList}
              voteRecords={voteRecordsList}
            />
            <ActivityTicker proposals={proposalsList} nowSeconds={Math.floor(Date.now() / 1000)} />
            <ConfigsSection configs={configsList} roleTypes={roleTypeList} />
            {hasProposals ? (
              <ProposalsSection
                proposals={proposalsList}
                configs={configsList}
                roleTypes={roleTypeList}
                roles={rolesList}
                voteRecords={voteRecordsList}
                trustId={trustId}
                trustAddress={trustAddress}
                viewerCreatorAddress={viewerCreatorAddress}
              />
            ) : (
              <NoProposalsYetCard onOpen={() => setNewProposalOpen(true)} />
            )}
          </>
        )}
      </PageBody>
      <NewProposalModal
        open={newProposalOpen}
        trustId={trustId}
        trustAddress={trustAddress}
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
