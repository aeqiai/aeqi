/**
 * Quorum surface — `NewProposalModal` (header CTA write surface).
 *
 * Extracted from `QuorumPage.write.tsx` so the iter-5 IPFS pre-pin
 * path doesn&apos;t push that file past the 600-line lint cap. Owns:
 *
 *   - Selected-config preview tile (quorum / support / voting period).
 *   - Title + description fields with validation hints.
 *   - IPFS pre-pin row (the iter-5 functional gap): operator can pin
 *     the title+description to IPFS BEFORE the on-chain ix fires;
 *     the returned CID threads straight into `proposalCreate`.
 *   - Vote window + execution delay numeric inputs.
 *   - Submit handler with honest-stub TBD surfacing.
 *
 * Honest-stub contract: the platform endpoint `/api/solana/proposal-create`
 * does not exist yet. The modal POSTs to the canonical path; the platform
 * returns 404 / `endpoint_unimplemented` until shipped. When that happens
 * we surface "platform-side TBD" plainly inside the modal instead of
 * pretending the request succeeded.
 */
import { useMemo, useState } from "react";

import type { GovernanceConfigWithPda, RoleTypeWithPda } from "@/solana";
import { ApiError, api } from "@/lib/api";
import { Banner, Button, Inline, Input, Modal, Select, Stack, Textarea } from "@/components/ui";
import styles from "./QuorumPage.module.css";
import { CopyableMono } from "./QuorumPage.parts";
import { bpsLabel, bytesToHex, configIdLabel, durationLabel } from "./QuorumPage.format";
import { useQuorumInvalidator } from "./QuorumPage.actions";

/**
 * `NewProposalModal` — opens a proposal against a registered config.
 */
export function NewProposalModal({
  open,
  companyId,
  companyAddress,
  configs,
  roleTypes,
  onClose,
  onSuccess,
  initialConfigIdHex,
}: {
  open: boolean;
  companyId: string;
  companyAddress: string;
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  onClose: () => void;
  onSuccess?: () => void;
  /** Optional pre-selection — used by the config switcher chip row. */
  initialConfigIdHex?: string;
}) {
  const invalidate = useQuorumInvalidator(companyAddress);
  const [configIdHex, setConfigIdHex] = useState<string>(() => {
    if (initialConfigIdHex) return initialConfigIdHex;
    return configs.length > 0 ? configIdHexFor(configs[0].account.governanceConfigId) : "";
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteHours, setVoteHours] = useState("72");
  const [execDelayHours, setExecDelayHours] = useState("24");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tbdNote, setTbdNote] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // iter-9: action template selection. Templates pre-populate the
  // description with a structured stub (a checklist of the fields a
  // proper proposal of that kind should specify) and surface a
  // matching calldata hint banner so the proposer knows what the
  // executor will look for in the IPFS payload. Free-form is the
  // default sentinel — no pre-fill, no hint banner.
  const [templateKind, setTemplateKind] = useState<ProposalTemplateKind>("free_form");
  // IPFS pre-pin state. The operator can pin the title+description to
  // IPFS BEFORE opening the proposal; the returned CID is shown inline
  // and threaded through to `proposalCreate`. If they skip it, the
  // platform pins server-side as a fallback (today: TBD).
  const [pinning, setPinning] = useState(false);
  const [pinnedCid, setPinnedCid] = useState<string | null>(null);
  const [pinnedGateway, setPinnedGateway] = useState<string | null>(null);
  const [pinTbd, setPinTbd] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  // iter-10: once a pin completes the CID is opaque — operators can read
  // it but don&apos;t see what they actually committed to without a side
  // trip to the gateway. The toggle exposes the JSON shape that was
  // pinned (the same `{ title, description }` object the modal POSTs)
  // so the operator can sanity-check the body before firing the
  // proposalCreate ix.
  const [previewPinned, setPreviewPinned] = useState(false);

  const configOptions = useMemo(
    () =>
      configs.map((c) => ({
        value: configIdHexFor(c.account.governanceConfigId),
        label: configIdLabel(c.account.governanceConfigId, roleTypes),
      })),
    [configs, roleTypes],
  );

  const selectedConfig = useMemo(() => {
    if (!configIdHex) return undefined;
    return configs.find((c) => configIdHexFor(c.account.governanceConfigId) === configIdHex);
  }, [configIdHex, configs]);

  // Per-field validation. Bounded ranges read as deliberate cost-of-time
  // calls: 1h floor + 7d ceiling on the vote window keeps anyone from
  // accidentally opening a 5-second proposal nobody can vote on or a
  // 100-year proposal that hangs the surface indefinitely. Exec delay
  // shares the same 7d ceiling and allows 0 for "execute as soon as
  // succeeded" workflows.
  const MIN_VOTE_HOURS = 1;
  const MAX_VOTE_HOURS = 24 * 7;
  const MIN_EXEC_DELAY_HOURS = 0;
  const MAX_EXEC_DELAY_HOURS = 24 * 7;

  const titleTrim = title.trim();
  const descTrim = description.trim();
  const titleValid = titleTrim.length >= 3 && titleTrim.length <= 120;
  const descValid = descTrim.length >= 10 && descTrim.length <= 4000;

  const voteHoursNum = Number(voteHours);
  const execDelayNum = Number(execDelayHours);
  const voteHoursValid =
    voteHours.trim().length > 0 &&
    Number.isFinite(voteHoursNum) &&
    Number.isInteger(voteHoursNum) &&
    voteHoursNum >= MIN_VOTE_HOURS &&
    voteHoursNum <= MAX_VOTE_HOURS;
  const execDelayValid =
    execDelayHours.trim().length > 0 &&
    Number.isFinite(execDelayNum) &&
    Number.isInteger(execDelayNum) &&
    execDelayNum >= MIN_EXEC_DELAY_HOURS &&
    execDelayNum <= MAX_EXEC_DELAY_HOURS;

  // Surface coherent per-field errors only once the operator has touched
  // the field (non-empty input). Empty + invalid stays silent so the
  // first-render modal doesn&apos;t shout at them.
  const voteHoursError = !voteHoursValid
    ? voteHours.trim().length === 0
      ? "Vote window required."
      : !Number.isFinite(voteHoursNum) || !Number.isInteger(voteHoursNum)
        ? "Whole number of hours."
        : voteHoursNum < MIN_VOTE_HOURS
          ? `At least ${MIN_VOTE_HOURS}h to give voters a window.`
          : `At most ${MAX_VOTE_HOURS}h (one week).`
    : undefined;
  const execDelayError = !execDelayValid
    ? execDelayHours.trim().length === 0
      ? "Execution delay required (0 is fine)."
      : !Number.isFinite(execDelayNum) || !Number.isInteger(execDelayNum)
        ? "Whole number of hours."
        : execDelayNum < MIN_EXEC_DELAY_HOURS
          ? "Cannot be negative."
          : `At most ${MAX_EXEC_DELAY_HOURS}h (one week).`
    : undefined;

  // Config-level health gate. A config with `quorumBps === 0` would let
  // a proposal pass with zero votes — that&apos;s a misconfigured config,
  // not a feature. Surface it as a banner and block submit. supportBps=0
  // is technically valid (unanimous-against still loses) but flag it too
  // since it&apos;s almost certainly a misconfiguration.
  const configQuorumZero = !!selectedConfig && selectedConfig.account.quorumBps === 0;
  const configSupportZero = !!selectedConfig && selectedConfig.account.supportBps === 0;
  const configMisconfigured = configQuorumZero || configSupportZero;

  const canSubmit =
    !!configIdHex &&
    !configMisconfigured &&
    titleValid &&
    descValid &&
    voteHoursValid &&
    execDelayValid &&
    !submitting;

  const reset = () => {
    setTitle("");
    setDescription("");
    setVoteHours("72");
    setExecDelayHours("24");
    setError(null);
    setTbdNote(null);
    setSuccess(null);
    setPinning(false);
    setPinnedCid(null);
    setPinnedGateway(null);
    setPinTbd(false);
    setPinError(null);
    setPreviewPinned(false);
    setTemplateKind("free_form");
  };

  /**
   * iter-9: pick an action template. Pre-fills the description (or
   * clears it back to empty when the operator picks free_form), drops
   * any IPFS-pinned CID (the body changed so the pin is stale), and
   * surfaces the calldata hint banner. We pre-fill the description ONLY
   * when it's empty OR still matches a prior template stub — never
   * stomp text the operator has typed.
   */
  const applyTemplate = (next: ProposalTemplateKind) => {
    setTemplateKind(next);
    if (pinnedCid) {
      setPinnedCid(null);
      setPinnedGateway(null);
      setPreviewPinned(false);
    }
    const trimmed = description.trim();
    const isPrefillReplaceable =
      trimmed.length === 0 || PROPOSAL_TEMPLATES.some((t) => t.descriptionStub.trim() === trimmed);
    if (!isPrefillReplaceable) return;
    const stub = templateForKind(next).descriptionStub;
    setDescription(stub);
  };

  // Drop a stale CID whenever the operator edits title or description —
  // the pinned blob would no longer match what the form would submit.
  // The preview toggle collapses alongside the CID so a "Preview content"
  // pane isn't left dangling against fields that no longer match.
  const onTitleChange = (v: string) => {
    setTitle(v);
    if (pinnedCid) {
      setPinnedCid(null);
      setPinnedGateway(null);
      setPreviewPinned(false);
    }
  };
  const onDescriptionChange = (v: string) => {
    setDescription(v);
    if (pinnedCid) {
      setPinnedCid(null);
      setPinnedGateway(null);
      setPreviewPinned(false);
    }
  };

  const handlePin = async () => {
    if (!titleValid || !descValid) return;
    setPinning(true);
    setPinError(null);
    setPinTbd(false);
    try {
      const result = await api.ipfsUpload({
        entity_id: companyId,
        kind: "proposal",
        content: {
          title: title.trim(),
          description: description.trim(),
        },
      });
      if (result.platform_side_tbd) {
        setPinTbd(true);
      } else {
        setPinnedCid(result.cid);
        setPinnedGateway(result.gateway_url || `https://ipfs.io/ipfs/${result.cid}`);
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setPinTbd(true);
      } else {
        setPinError(err instanceof Error ? err.message : "Couldn't pin to IPFS.");
      }
    } finally {
      setPinning(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setTbdNote(null);
    setSuccess(null);
    try {
      const result = await api.proposalCreate({
        entity_id: companyId,
        governance_config_id_hex: configIdHex,
        title: title.trim(),
        description: description.trim(),
        vote_duration_seconds: Math.round(Number(voteHours) * 3600),
        execution_delay_seconds: Math.round(Number(execDelayHours) * 3600),
        ipfs_cid: pinnedCid ?? undefined,
      });
      if (result.platform_side_tbd) {
        setTbdNote(
          "Proposal request shaped + accepted, but the platform handler hasn't shipped — no on-chain proposal yet.",
        );
      } else {
        const cidHint = result.ipfs_cid
          ? `, pinned ${result.ipfs_cid.slice(0, 10)}…`
          : pinnedCid
            ? `, pinned ${pinnedCid.slice(0, 10)}…`
            : "";
        setSuccess(`Proposal opened · ${result.signature_b58.slice(0, 12)}…${cidHint}`);
        invalidate({ kind: "propose" });
      }
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setTbdNote(
          "Platform-side TBD: the `/api/solana/proposal-create` endpoint is owned by a sibling quest and isn't live yet. The form shape matches the contract that will ship.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Couldn't open proposal.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Open a new proposal"
    >
      <div className={`${styles.scope} ${styles.modalBody}`}>
        <Stack gap="4">
          {configs.length === 0 ? (
            <Banner kind="warning">
              No voting configs registered. Register one before opening a proposal.
            </Banner>
          ) : (
            <>
              <label className={styles.proposalFieldLabel}>
                <span>Voting config</span>
                <Select
                  options={configOptions}
                  value={configIdHex}
                  onChange={setConfigIdHex}
                  placeholder="Select a voting config"
                  size="md"
                  fullWidth
                  aria-label="Voting config"
                />
              </label>
              {selectedConfig ? (
                <div
                  className={styles.configPreview}
                  aria-label="Selected voting config thresholds"
                >
                  <div className={styles.configPreviewRow}>
                    <span className={styles.configPreviewLabel}>Quorum</span>
                    <span className={styles.configPreviewValue}>
                      {bpsLabel(selectedConfig.account.quorumBps)}
                    </span>
                  </div>
                  <div className={styles.configPreviewRow}>
                    <span className={styles.configPreviewLabel}>Support</span>
                    <span className={styles.configPreviewValue}>
                      {bpsLabel(selectedConfig.account.supportBps)}
                    </span>
                  </div>
                  <div className={styles.configPreviewRow}>
                    <span className={styles.configPreviewLabel}>Voting period</span>
                    <span className={styles.configPreviewValue}>
                      {durationLabel(selectedConfig.account.votingPeriod)}
                    </span>
                  </div>
                </div>
              ) : null}
              <div
                className={styles.proposalTemplateRow}
                role="radiogroup"
                aria-label="Proposal action template"
              >
                <span className={styles.proposalTemplateLabel}>Template</span>
                <div className={styles.proposalTemplatePills}>
                  {PROPOSAL_TEMPLATES.map((tpl) => (
                    <Button
                      key={tpl.kind}
                      variant={templateKind === tpl.kind ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => applyTemplate(tpl.kind)}
                      aria-pressed={templateKind === tpl.kind}
                      title={tpl.blurb}
                    >
                      {tpl.label}
                    </Button>
                  ))}
                </div>
              </div>
              <Input
                label="Title"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="What is this proposal about?"
                size="md"
                hint="3-120 characters. Surfaces on the proposal row."
                error={title.length > 0 && !titleValid ? "Title must be 3-120 chars." : undefined}
              />
              <Textarea
                label="Description"
                value={description}
                onChange={(e) => onDescriptionChange(e.target.value)}
                rows={5}
                placeholder="Full rationale, links, on-chain effects."
                hint="10-4000 characters. Pinned to IPFS as the proposal's ipfs_cid."
                error={
                  description.length > 0 && !descValid
                    ? "Description must be 10-4000 chars."
                    : undefined
                }
              />
              {templateForKind(templateKind).calldataHint ? (
                <Banner kind="info">{templateForKind(templateKind).calldataHint}</Banner>
              ) : null}
              <div className={styles.ipfsPinRow} aria-label="IPFS pre-pin">
                <div className={styles.ipfsPinCopy}>
                  <span className={styles.ipfsPinLabel}>IPFS payload</span>
                  {pinnedCid ? (
                    <Inline gap="2" align="center" wrap>
                      <CopyableMono full={pinnedCid} display={pinnedCid} />
                      {pinnedGateway ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(pinnedGateway, "_blank", "noopener")}
                        >
                          Open
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewPinned((v) => !v)}
                        aria-expanded={previewPinned}
                        aria-label={previewPinned ? "Hide pinned content" : "Show pinned content"}
                      >
                        {previewPinned ? "Hide preview" : "Preview content"}
                      </Button>
                    </Inline>
                  ) : (
                    <span className={styles.ipfsPinHint}>
                      Pin now to lock the title + description CID before the on-chain ix fires.
                    </span>
                  )}
                </div>
                <Button
                  variant={pinnedCid ? "secondary" : "ghost"}
                  size="sm"
                  onClick={handlePin}
                  disabled={pinning || !titleValid || !descValid || !!pinnedCid}
                  aria-label="Pin proposal payload to IPFS"
                >
                  {pinning ? "Pinning…" : pinnedCid ? "Pinned" : "Pin payload"}
                </Button>
              </div>
              {pinnedCid && previewPinned ? (
                <pre className={styles.ipfsPinPreview} aria-label="Pinned IPFS payload preview">
                  {JSON.stringify(
                    {
                      title: title.trim(),
                      description: description.trim(),
                    },
                    null,
                    2,
                  )}
                </pre>
              ) : null}
              {pinError ? <Banner kind="error">{pinError}</Banner> : null}
              {pinTbd ? (
                <Banner kind="warning">
                  IPFS pin TBD: `/api/ipfs/pin-proposal` isn&apos;t live yet. The platform will pin
                  the payload server-side at create time as a fallback — your proposal still opens.
                </Banner>
              ) : null}
              <Inline gap="3" wrap>
                <Input
                  label="Vote window (hours)"
                  type="number"
                  min={MIN_VOTE_HOURS}
                  max={MAX_VOTE_HOURS}
                  step={1}
                  value={voteHours}
                  onChange={(e) => setVoteHours(e.target.value)}
                  size="md"
                  hint={`How long voting stays open. ${MIN_VOTE_HOURS}-${MAX_VOTE_HOURS}h.`}
                  error={voteHoursError}
                />
                <Input
                  label="Execution delay (hours)"
                  type="number"
                  min={MIN_EXEC_DELAY_HOURS}
                  max={MAX_EXEC_DELAY_HOURS}
                  step={1}
                  value={execDelayHours}
                  onChange={(e) => setExecDelayHours(e.target.value)}
                  size="md"
                  hint={`Timelock between success and execute. ${MIN_EXEC_DELAY_HOURS}-${MAX_EXEC_DELAY_HOURS}h.`}
                  error={execDelayError}
                />
              </Inline>
              {configMisconfigured ? (
                <Banner kind="error">
                  {configQuorumZero && configSupportZero
                    ? "Selected config has quorum + support = 0% — any proposal would pass without votes. Pick a different config or update this one before opening a proposal."
                    : configQuorumZero
                      ? "Selected config has quorum = 0% — any proposal would pass without votes. Pick a different config or update this one before opening a proposal."
                      : "Selected config has support = 0% — any proposal would pass without for-votes. Pick a different config or update this one before opening a proposal."}
                </Banner>
              ) : null}
            </>
          )}
          {error ? <Banner kind="error">{error}</Banner> : null}
          {tbdNote ? <Banner kind="warning">{tbdNote}</Banner> : null}
          {success ? <Banner kind="success">{success}</Banner> : null}
          <Inline gap="2" justify="end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {submitting ? "Opening…" : "Open proposal"}
            </Button>
          </Inline>
        </Stack>
      </div>
    </Modal>
  );
}

/**
 * Convert an Anchor-decoded `governance_config_id` (Uint8Array OR
 * number[], length 32) into a 0x-prefixed lowercase-hex string suitable
 * for the platform's `governance_config_id_hex` field.
 */
function configIdHexFor(bytes: Uint8Array | number[]): string {
  return `0x${bytesToHex(bytes)}`;
}

/* ────────────────────────────────────────────────────────────────── */
/* Action templates                                                    */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Proposal template kinds — match the common shapes a COMPANY will open
 * proposals against. Free-form is the default and matches iter-1..8
 * behavior (no pre-fill).
 *
 * The on-chain `aeqi_governance` Proposal account doesn't carry calldata
 * — execution intent lives in the IPFS-pinned payload referenced by
 * `ipfs_cid`. The executor reads that payload and dispatches to the
 * matching module. So a "template" here is really:
 *   1. A structured Markdown stub the operator fills in (so the IPFS
 *      payload has the fields the executor expects).
 *   2. A "calldata hint" — a short Banner the operator can read in-modal
 *      before submitting, calling out which fields are load-bearing for
 *      the executor.
 *
 * Future: when typed payload schemas land (an `aeqi-governance-payloads`
 * crate or similar), we can extend each template to emit a JSON-Schema
 * preview AND validate the description against it before the
 * `proposalCreate` POST.
 */
export type ProposalTemplateKind =
  | "free_form"
  | "treasury_transfer"
  | "module_upgrade"
  | "role_grant";

interface ProposalTemplate {
  kind: ProposalTemplateKind;
  label: string;
  /** Used as the tooltip on the pill — explains what kind of proposal
   *  this shape backs without forcing the operator to click in. */
  blurb: string;
  /** Markdown-ish body that pre-populates the description textarea. */
  descriptionStub: string;
  /** Inline calldata hint shown beneath the description as a Banner.
   *  Null for free-form (no hint, no banner). */
  calldataHint: string | null;
}

const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    kind: "free_form",
    label: "Free-form",
    blurb: "Open a proposal without a template. The IPFS payload is whatever you write.",
    descriptionStub: "",
    calldataHint: null,
  },
  {
    kind: "treasury_transfer",
    label: "Treasury transfer",
    blurb:
      "Move funds out of the COMPANY treasury. Executor reads recipient + token mint + amount from the payload.",
    descriptionStub: [
      "## Treasury transfer",
      "",
      "**Recipient (base58):** <fill recipient pubkey>",
      "**Token mint (base58):** <native SOL or SPL mint pubkey>",
      "**Amount (smallest unit):** <integer>",
      "**Rationale:** <why this transfer, link to upstream decision>",
      "",
      "On-chain effect: `aeqi_treasury::transfer` called with the above against the COMPANY treasury vault.",
    ].join("\n"),
    calldataHint:
      "Treasury executor will look for `recipient`, `mint`, and `amount` (in smallest unit) inside the pinned payload. Double-check the mint — passing the wrong one transfers the wrong asset.",
  },
  {
    kind: "module_upgrade",
    label: "Module upgrade",
    blurb:
      "Swap a registered module to a new program id. Executor reads module id + new program id from the payload.",
    descriptionStub: [
      "## Module upgrade",
      "",
      "**Module id (label or 32-byte sentinel):** <e.g. `treasury`, `governance`>",
      "**New program id (base58):** <fill upgraded program pubkey>",
      "**Init args (hex bytes):** <optional, defaults to empty>",
      "**Migration notes:** <breaking changes, storage layout, downgrade path>",
      "",
      "On-chain effect: `aeqi_factory::upgrade_module` rewires the COMPANY's module registry to point at the new program. ALL future calls to that module go through the new program id.",
    ].join("\n"),
    calldataHint:
      "Module executor will look for `module_id`, `new_program_id`, and optional `init_args` (hex). The upgrade is one-way — make sure the new program is audited and has a downgrade story before voting `for`.",
  },
  {
    kind: "role_grant",
    label: "Role grant",
    blurb:
      "Grant or revoke a role on the COMPANY. Executor reads role type + holder + grant-or-revoke from the payload.",
    descriptionStub: [
      "## Role grant",
      "",
      "**Role type (label):** <e.g. `treasurer`, `operator`>",
      "**Holder (base58):** <fill recipient EOA>",
      "**Action:** grant | revoke",
      "**Authority scope:** <what this role lets the holder do, list module ids>",
      "",
      "On-chain effect: `aeqi_company::grant_role` (or `revoke_role`) updates the role registry. The holder gains (or loses) any authority transitively reachable from this role.",
    ].join("\n"),
    calldataHint:
      "Company executor will look for `role_type`, `holder`, and `action` (grant|revoke) in the pinned payload. Granting a role transitively elevates the holder's authority — review the role's downstream edges before voting.",
  },
];

function templateForKind(kind: ProposalTemplateKind): ProposalTemplate {
  return PROPOSAL_TEMPLATES.find((t) => t.kind === kind) ?? PROPOSAL_TEMPLATES[0];
}
