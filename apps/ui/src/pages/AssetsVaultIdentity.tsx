/**
 * `VaultIdentitySection` — the per-module provisioning table that lives
 * just below the Capitalize action card. Iter-5 introduced per-module
 * rows with version + initialized flag; iter-6 wires each row as a
 * click-through into `ModuleDetailModal` and extracts the section out
 * of `AssetsExtras.tsx` so that file stays under the 600-line lint
 * ceiling.
 *
 * The section is intentionally read-only: identity is set by the on-chain
 * registerModule / adoptModuleImplementation / setModuleAcl
 * instructions, never from the dashboard. The clickable rows surface
 * what each slot is and how to drill in.
 */
import { useMemo } from "react";

import type { ModuleAccountWithPda } from "@/solana";
import { getAeqiProgramName } from "@/solana/program-names";
import { formatInteger } from "@/lib/i18n";
import { explorerClusterLabel } from "@/lib/solana-explorer";
import { Badge, DetailField, Inline, PageSection } from "@/components/ui";

import { CopyableMono, bytesIdLabel, shortAddress } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

export function VaultIdentitySection({
  moduleStatePda,
  vaultAuthorityPda,
  treasuryAuthority,
  trustAuthority,
  moduleInitialized,
  modules,
  onSelectModule,
}: {
  moduleStatePda: string;
  vaultAuthorityPda: string;
  treasuryAuthority: string | null;
  trustAuthority: string | null;
  moduleInitialized: boolean;
  modules: ModuleAccountWithPda[];
  /** Iter-6: click-through on a module row opens the detail modal with
   *  ACL bits + recent signature tail. Optional — host pages without a
   *  modal mount can omit it and the rows stay non-interactive. */
  onSelectModule?: (module: ModuleAccountWithPda) => void;
}) {
  const cluster = explorerClusterLabel();
  const clusterPretty = formatClusterLabel(cluster);
  const clusterVariant = clusterTone(cluster);

  // Per-module rows — one row per module *slot* (not per distinct
  // program). Iter-6: each row carries a back-reference to the original
  // ModuleAccountWithPda so the click-through handler can open the
  // ModuleDetailModal without re-resolving the account.
  const moduleRows = useMemo(() => {
    return modules.map((m) => {
      const pid = m.account.programId.toBase58();
      return {
        key: m.publicKey.toBase58(),
        programId: pid,
        programName: getAeqiProgramName(pid),
        moduleLabel: bytesIdLabel(m.account.moduleId),
        initialized: Number(m.account.initialized) > 0,
        version: m.account.implementationVersion.toString(),
        provider: m.account.provider.toBase58(),
        original: m,
      };
    });
  }, [modules]);

  const provisioning = useMemo(() => {
    if (moduleRows.length === 0) return { initialized: 0, total: 0 };
    const initialized = moduleRows.filter((m) => m.initialized).length;
    return { initialized, total: moduleRows.length };
  }, [moduleRows]);

  return (
    <PageSection title="Vault identity">
      <DetailField label="Network">
        <Inline gap="2">
          <Badge variant={clusterVariant} dot>
            {clusterPretty}
          </Badge>
          <span className={styles.mutedLabel}>{cluster}</span>
        </Inline>
      </DetailField>
      <DetailField label="Vault authority (PDA)">
        <CopyableMono
          full={vaultAuthorityPda}
          display={shortAddress(vaultAuthorityPda)}
          withExplorer
        />
      </DetailField>
      <DetailField label="Module state (PDA)">
        <CopyableMono full={moduleStatePda} display={shortAddress(moduleStatePda)} withExplorer />
      </DetailField>
      <DetailField label="Treasury authority">
        {treasuryAuthority ? (
          <CopyableMono
            full={treasuryAuthority}
            display={shortAddress(treasuryAuthority)}
            withExplorer
          />
        ) : (
          <span className={styles.mutedDash}>—</span>
        )}
      </DetailField>
      <DetailField label="TRUST authority">
        {trustAuthority ? (
          <CopyableMono full={trustAuthority} display={shortAddress(trustAuthority)} withExplorer />
        ) : (
          <span className={styles.mutedDash}>—</span>
        )}
      </DetailField>
      <DetailField label="Treasury module">
        <Badge variant={moduleInitialized ? "success" : "muted"} dot>
          {moduleInitialized ? "Initialized" : "Not initialized"}
        </Badge>
      </DetailField>
      <DetailField
        label={
          moduleRows.length === 0
            ? "Modules registered"
            : `Modules registered (${formatInteger(provisioning.initialized)}/${formatInteger(provisioning.total)} initialized)`
        }
      >
        {moduleRows.length === 0 ? (
          <span className={styles.mutedDash}>None yet</span>
        ) : (
          <ul className={styles.moduleRowsList}>
            {moduleRows.map((m) => {
              const body = (
                <>
                  <div className={styles.moduleRowHead}>
                    <span className={styles.modulesName}>
                      {m.programName ?? "External program"}
                    </span>
                    <Badge variant={m.initialized ? "success" : "muted"} size="sm" dot>
                      {m.initialized ? "Initialized" : "Not initialized"}
                    </Badge>
                    {m.version !== "0" && (
                      <span className={styles.moduleVersion}>v{m.version}</span>
                    )}
                  </div>
                  <div className={styles.moduleRowMeta}>
                    <span className={styles.moduleRowField}>
                      <span className={styles.moduleRowFieldLabel}>Slot</span>
                      <span className={styles.monoCellInline}>{m.moduleLabel}</span>
                    </span>
                    <span className={styles.moduleRowField}>
                      <span className={styles.moduleRowFieldLabel}>Program</span>
                      <CopyableMono
                        full={m.programId}
                        display={shortAddress(m.programId)}
                        tone="muted"
                        withExplorer
                      />
                    </span>
                  </div>
                </>
              );
              return (
                <li key={m.key} className={styles.moduleRow}>
                  {onSelectModule ? (
                    /* `role="button"` rather than a real button element,
                       because the row embeds interactive children
                       (CopyableMono is itself focusable + a copy target;
                       the explorer satellite is a link). Nesting
                       interactive controls inside a button is invalid
                       HTML — we treat the row as a clickable region
                       instead and rely on the inner CopyableMono /
                       link's stopPropagation to prevent double activation. */
                    <div
                      role="button"
                      tabIndex={0}
                      className={styles.moduleRowButton}
                      onClick={() => onSelectModule(m.original)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectModule(m.original);
                        }
                      }}
                      aria-label={`Open ${m.programName ?? "module"} detail`}
                    >
                      {body}
                    </div>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DetailField>
    </PageSection>
  );
}

/** Cluster label → human-readable label. The env var carries the raw
 *  cluster slug (`mainnet`, `devnet`, `localnet-solana`); the badge wants
 *  Title Case without the redundant `-solana` suffix. */
function formatClusterLabel(cluster: string): string {
  if (cluster === "mainnet" || cluster === "mainnet-beta") return "Mainnet";
  if (cluster === "devnet") return "Devnet";
  if (cluster === "testnet") return "Testnet";
  if (cluster.startsWith("localnet")) return "Localnet";
  return cluster.charAt(0).toUpperCase() + cluster.slice(1);
}

/** Map the cluster to a badge variant. Mainnet is the production
 *  signal (success-tinted); devnet/testnet are warning-tinted so the
 *  operator never misreads where the read is coming from. Localnet
 *  is neutral — clearly dev. */
function clusterTone(cluster: string): "success" | "warning" | "muted" {
  if (cluster === "mainnet" || cluster === "mainnet-beta") return "success";
  if (cluster === "devnet" || cluster === "testnet") return "warning";
  return "muted";
}
