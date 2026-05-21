/**
 * Iter-6 — per-module click-through detail surface.
 *
 * `VaultIdentitySection` lists every Module slot registered on the
 * TRUST, but iter-5 capped at the row level — Program / Slot / Version
 * / Initialized. Operators couldn't see the ACL bit-flags (who this
 * module is allowed to talk to on the inter-module graph) or the
 * recent on-chain signature tail against the Module account, both of
 * which matter when debugging whether a registered module is actually
 * doing work.
 *
 * This modal opens when a row in the modules list is clicked. It
 * surfaces:
 *   1. Identity — program ID, provider, implementation version,
 *      module slot label, implementation metadata hash.
 *   2. ACL bits — `trustAcl` u64 unpacked into a list of set bit
 *      positions + hex representation. The bit *meanings* live in
 *      each module program's source, not the IDL, so we render the
 *      raw flags honestly and link the operator to inspect on-chain
 *      rather than fabricate labels.
 *   3. Recent module activity — signatures against the Module PDA
 *      (`useVaultActivity` reused — same hook, different PDA), giving
 *      a 30d tail of every adopt-implementation / set-ACL / register
 *      instruction that touched this slot.
 *
 * Honest scope:
 *   - We do NOT decode each signature into a typed instruction. The
 *     module-state graph carries many program variants (treasury,
 *     vesting, role, role_budget, governance, etc.) and decoding each
 *     would balloon scope. Signatures land here as timestamp + explorer
 *     deep-link.
 *   - The "child-budget tree" the iter-6 brief mentioned is not
 *     surfaced here. Budgets reference roles (`target_role_id`), not
 *     module IDs — there's no on-chain back-link from a module to the
 *     budgets it would allocate. The honest answer is "the Active
 *     budgets section below covers that scope"; we link to it in the
 *     footer rather than fabricate a tree.
 */
import { ExternalLink } from "lucide-react";

import type { ModuleAccountWithPda } from "@/solana";
import { getAeqiProgramName } from "@/solana/program-names";
import { useVaultActivity } from "@/hooks/useVaultActivity";
import { formatDateTime, formatInteger } from "@/lib/i18n";
import { explorerTxUrl } from "@/lib/solana-explorer";
import { Badge, DetailField, Icon, Loading, Modal, Stack } from "@/components/ui";

import { CopyableMono, bytesIdLabel, bytesToHex, shortAddress } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

/**
 * Unpack a u64 ACL value into the list of set bit positions (0..63).
 * Returned ascending so the operator reads "bits 0, 3, 5" left-to-right.
 * Anchor maps u64 → bn.js at runtime; the input is a string-coerced
 * representation so we can walk it with BigInt in JS without needing
 * a BN runtime here.
 */
function unpackAclBits(aclRaw: string): number[] {
  let value: bigint;
  try {
    value = BigInt(aclRaw);
  } catch {
    return [];
  }
  if (value <= 0n) return [];
  const bits: number[] = [];
  for (let i = 0; i < 64; i += 1) {
    if ((value >> BigInt(i)) & 1n) bits.push(i);
  }
  return bits;
}

export interface ModuleDetailModalProps {
  module: ModuleAccountWithPda | null;
  onClose: () => void;
}

export function ModuleDetailModal({ module, onClose }: ModuleDetailModalProps) {
  if (!module) {
    return <Modal open={false} onClose={onClose} title="Module" children={null} />;
  }
  const acc = module.account;
  const programId = acc.programId.toBase58();
  const programName = getAeqiProgramName(programId);
  const slotLabel = bytesIdLabel(acc.moduleId);
  const provider = acc.provider.toBase58();
  const version = acc.implementationVersion.toString();
  const metadataHex = `0x${bytesToHex(acc.implementationMetadataHash)}`;
  const initialized = Number(acc.initialized) > 0;
  const aclRaw = acc.trustAcl.toString();
  const aclBits = unpackAclBits(aclRaw);
  const aclHex = (() => {
    try {
      const v = BigInt(aclRaw);
      return `0x${v.toString(16).padStart(16, "0")}`;
    } catch {
      return aclRaw;
    }
  })();

  return (
    <Modal open={true} onClose={onClose} title={`Module · ${programName ?? "External"}`}>
      <Stack gap="4">
        <div className={styles.moduleDetailHead}>
          <Badge variant={initialized ? "success" : "muted"} dot>
            {initialized ? "Initialized" : "Not initialized"}
          </Badge>
          {version !== "0" && (
            <Badge variant="neutral" dot>
              v{version}
            </Badge>
          )}
          <span className={styles.moduleDetailSubtitle}>Slot {slotLabel}</span>
        </div>
        <DetailField label="Module PDA">
          <CopyableMono
            full={module.publicKey.toBase58()}
            display={shortAddress(module.publicKey.toBase58())}
            withExplorer
          />
        </DetailField>
        <DetailField label="Program">
          <Stack gap="1">
            <CopyableMono full={programId} display={shortAddress(programId)} withExplorer />
            {programName && <span className={styles.moduleDetailSubtitle}>{programName}</span>}
          </Stack>
        </DetailField>
        <DetailField label="Provider">
          <CopyableMono full={provider} display={shortAddress(provider)} withExplorer />
        </DetailField>
        <DetailField label="Implementation metadata hash">
          <CopyableMono full={metadataHex} display={`${metadataHex.slice(0, 16)}…`} mode="short" />
        </DetailField>
        <DetailField label={`Trust ACL · ${aclHex}`}>
          {aclBits.length === 0 ? (
            <span className={styles.modalDetailNote}>
              No ACL bits set — this module has no granted capabilities yet.
            </span>
          ) : (
            <Stack gap="1">
              <span className={styles.modalDetailNote}>
                {formatInteger(aclBits.length)} bit{aclBits.length === 1 ? "" : "s"} set. Bit
                meanings are program-specific and not surfaced in the IDL; consult the module
                program source for the canonical legend.
              </span>
              <span className={styles.monoCell}>bits {aclBits.map((b) => `#${b}`).join(", ")}</span>
            </Stack>
          )}
        </DetailField>
        <ModuleSignatureTail moduleAddress={module.publicKey.toBase58()} />
        <p className={styles.modalFooterNote}>
          Budget allocations under a module live on the role program, not the module — see the
          Active budgets section in the page below for the role-scoped allocation table.
        </p>
      </Stack>
    </Modal>
  );
}

/**
 * Recent on-chain signatures against the Module PDA. Reuses
 * `useVaultActivity` (the same `getSignaturesForAddress` walker) since
 * the Module account is touched on every adopt-implementation /
 * register / set-ACL CPI. Capped at 8 visible rows so the modal stays
 * readable; "Showing N of M" footer is honest about truncation.
 */
function ModuleSignatureTail({ moduleAddress }: { moduleAddress: string }) {
  const VISIBLE = 8;
  const { data, isLoading } = useVaultActivity(moduleAddress, { windowDays: 30 });
  const signatures = data?.signatures ?? [];

  if (isLoading) {
    return <Loading variant="section" label="Scanning module signature tail" />;
  }
  if (signatures.length === 0) {
    return (
      <DetailField label="Recent activity">
        <span className={styles.modalDetailNote}>
          No on-chain signatures touched this Module account in the last 30 days.
        </span>
      </DetailField>
    );
  }
  const visible = signatures.slice(0, VISIBLE);
  const hidden = signatures.length - visible.length;
  return (
    <DetailField
      label={`Recent activity (${formatInteger(visible.length)}${
        hidden > 0 ? ` of ${formatInteger(signatures.length)}` : ""
      })`}
    >
      <ul className={styles.moduleSignatureList}>
        {visible.map((sig) => (
          <li key={sig.signature} className={styles.moduleSignatureItem}>
            <span className={styles.moduleSignatureWhen}>
              {sig.blockTime !== null ? formatDateTime(new Date(sig.blockTime * 1000)) : "—"}
            </span>
            <a
              href={explorerTxUrl(sig.signature)}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.budgetSpendLink}
              aria-label={`Open transaction ${sig.signature} in Solana explorer`}
            >
              <span className={styles.monoCell}>{shortAddress(sig.signature)}</span>
              <Icon icon={ExternalLink} size="xs" />
              {sig.err !== null && (
                <Badge variant="error" size="sm" dot>
                  Failed
                </Badge>
              )}
            </a>
          </li>
        ))}
      </ul>
    </DetailField>
  );
}
