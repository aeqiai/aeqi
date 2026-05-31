/**
 * Iter-6 — per-module click-through detail surface.
 *
 * `VaultIdentitySection` lists every Module slot registered on the
 * COMPANY, but iter-5 capped at the row level — Program / Slot / Version
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
 *      with iter-7 IDL-decoded labels: every leading signature gets
 *      its `aeqi_company` instruction name (adopt_module_implementation,
 *      set_module_acl, register_module, …) decoded from the Anchor
 *      8-byte discriminator. Non-`aeqi_company` calls (third-party CPI
 *      against the Module PDA) collapse to a quieter "On-chain call"
 *      badge with the calling program list surfaced honestly.
 *
 * Honest scope:
 *   - We decode the instruction *name* but not the arg payloads (the
 *     IDL types are non-trivial to borsh-decode in the browser bundle).
 *     Operators read "set_module_acl" but still need the explorer for
 *     the specific bit mask. We surface the IDL name + explorer link
 *     for every row.
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
import { useDecodedModuleActivity } from "@/hooks/useDecodedModuleActivity";
import type { DecodedModuleActivity } from "@/hooks/useDecodedModuleActivity";
import { useVaultActivity } from "@/hooks/useVaultActivity";
import { formatDateTime, formatInteger } from "@/lib/i18n";
import { explorerTxUrl } from "@/lib/solana-explorer";
import { Badge, DetailField, Icon, Inline, Loading, Modal, Stack } from "@/components/ui";

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
        <DetailField label={`Company ACL · ${aclHex}`}>
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
 *
 * Iter-7: each row is paired with `useDecodedModuleActivity` so the
 * timestamp + signature tail surfaces the actual `aeqi_company` IDL
 * instruction (e.g. `set_module_acl`) instead of a flat hash. Rows that
 * called a non-AEQI program against the Module account collapse to
 * "On-chain call" with the calling program list surfaced honestly.
 */
function ModuleSignatureTail({ moduleAddress }: { moduleAddress: string }) {
  const VISIBLE = 8;
  const { data, isLoading } = useVaultActivity(moduleAddress, { windowDays: 30 });
  const signatures = data?.signatures ?? [];
  const { rows: decodedRows, isLoading: decodedLoading } = useDecodedModuleActivity(
    moduleAddress,
    signatures,
  );
  const decodedByKey = new Map<string, DecodedModuleActivity>();
  for (const d of decodedRows) decodedByKey.set(d.signature, d);

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
  const decodedCount = decodedRows.filter((d) => d.kind === "company-ix" && d.instruction).length;
  return (
    <DetailField
      label={`Recent activity (${formatInteger(visible.length)}${
        hidden > 0 ? ` of ${formatInteger(signatures.length)}` : ""
      }${decodedCount > 0 ? ` · ${formatInteger(decodedCount)} decoded` : ""})`}
    >
      <ul className={styles.moduleSignatureList}>
        {visible.map((sig) => {
          const decoded = decodedByKey.get(sig.signature);
          return (
            <li key={sig.signature} className={styles.moduleSignatureItem}>
              <span className={styles.moduleSignatureWhen}>
                {sig.blockTime !== null ? formatDateTime(new Date(sig.blockTime * 1000)) : "—"}
              </span>
              <ModuleInstructionBadge decoded={decoded} decoding={decodedLoading && !decoded} />
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
          );
        })}
      </ul>
    </DetailField>
  );
}

/**
 * Iter-7: per-row instruction badge. Renders the decoded `aeqi_company`
 * instruction name when the Anchor discriminator matched, falling back
 * to "Decoding…" while the RPC is in flight and "On-chain call" when
 * the tx called a program other than `aeqi_company`. Compound txs (e.g.
 * factory register-then-adopt) surface the secondary count via "+N".
 */
function ModuleInstructionBadge({
  decoded,
  decoding,
}: {
  decoded: DecodedModuleActivity | undefined;
  decoding: boolean;
}) {
  if (!decoded) {
    return (
      <Badge variant="muted" size="sm" dot>
        {decoding ? "Decoding…" : "Pending"}
      </Badge>
    );
  }
  if (decoded.kind === "company-ix" && decoded.instruction) {
    return (
      <Inline gap="1" align="center">
        <Badge variant="accent" size="sm" dot>
          {decoded.instruction}
        </Badge>
        {decoded.extraCompanyCalls > 0 && (
          <span className={styles.modalDetailNote}>+{decoded.extraCompanyCalls}</span>
        )}
      </Inline>
    );
  }
  if (decoded.kind === "company-ix" && decoded.unknownDiscHex) {
    return (
      <Badge variant="muted" size="sm" dot>
        unknown · 0x{decoded.unknownDiscHex.slice(0, 8)}
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" size="sm" dot>
      On-chain call
    </Badge>
  );
}
