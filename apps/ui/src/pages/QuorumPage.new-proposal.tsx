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
  trustId,
  trustAddress,
  configs,
  roleTypes,
  onClose,
  onSuccess,
  initialConfigIdHex,
}: {
  open: boolean;
  trustId: string;
  trustAddress: string;
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  onClose: () => void;
  onSuccess?: () => void;
  /** Optional pre-selection — used by the config switcher chip row. */
  initialConfigIdHex?: string;
}) {
  const invalidate = useQuorumInvalidator(trustAddress);
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
  // IPFS pre-pin state. The operator can pin the title+description to
  // IPFS BEFORE opening the proposal; the returned CID is shown inline
  // and threaded through to `proposalCreate`. If they skip it, the
  // platform pins server-side as a fallback (today: TBD).
  const [pinning, setPinning] = useState(false);
  const [pinnedCid, setPinnedCid] = useState<string | null>(null);
  const [pinnedGateway, setPinnedGateway] = useState<string | null>(null);
  const [pinTbd, setPinTbd] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

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

  const titleValid = title.trim().length >= 3 && title.trim().length <= 120;
  const descValid = description.trim().length >= 10 && description.trim().length <= 4000;
  const hoursValid =
    Number.isFinite(Number(voteHours)) &&
    Number(voteHours) > 0 &&
    Number.isFinite(Number(execDelayHours)) &&
    Number(execDelayHours) >= 0;
  const canSubmit = !!configIdHex && titleValid && descValid && hoursValid && !submitting;

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
  };

  // Drop a stale CID whenever the operator edits title or description —
  // the pinned blob would no longer match what the form would submit.
  const onTitleChange = (v: string) => {
    setTitle(v);
    if (pinnedCid) {
      setPinnedCid(null);
      setPinnedGateway(null);
    }
  };
  const onDescriptionChange = (v: string) => {
    setDescription(v);
    if (pinnedCid) {
      setPinnedCid(null);
      setPinnedGateway(null);
    }
  };

  const handlePin = async () => {
    if (!titleValid || !descValid) return;
    setPinning(true);
    setPinError(null);
    setPinTbd(false);
    try {
      const result = await api.ipfsUpload({
        entity_id: trustId,
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
        entity_id: trustId,
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
                  min={1}
                  step={1}
                  value={voteHours}
                  onChange={(e) => setVoteHours(e.target.value)}
                  size="md"
                  hint="How long voting stays open."
                />
                <Input
                  label="Execution delay (hours)"
                  type="number"
                  min={0}
                  step={1}
                  value={execDelayHours}
                  onChange={(e) => setExecDelayHours(e.target.value)}
                  size="md"
                  hint="Timelock between success and execute."
                />
              </Inline>
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
