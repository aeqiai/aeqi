import { useMemo, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useIncorporation } from "@/hooks/useIncorporation";
import { getAeqiProgramName } from "@/solana";
import type { ModuleAccountWithPda, TrustAccount } from "@/solana";
import {
  Badge,
  DetailField,
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

/**
 * Incorporation — `i` in the AEQI grammar.
 *
 * The TRUST's constitutional surface — identity, authority, and the
 * module slots the TRUST has adopted on-chain. Replaces the prior
 * placeholder (commit pre-ja-001.2) with a real surface that reads
 * directly from the Solana cluster through the shared client in
 * `apps/ui/src/solana/`.
 *
 * Sections:
 *   1. Identity — trust_id (hex), authority (base58), creation_mode,
 *      paused, module count. Both pubkey-ish fields support
 *      copy-on-click of the full value.
 *   2. Modules — table of every Module account hanging off this TRUST,
 *      labelled with the friendly AEQI program name when recognized.
 *   3. Founding template — placeholder pending the platform exposing
 *      `entity.template_id` on `/api/entities`.
 *   4. Founders — defers to the chain-canonical Roles rewrite
 *      (ja-001.9); v1 surfaces only Trust.authority.
 *
 * Anti-scope: no write actions (pause toggle, adopt-implementation,
 * ACL editor), no founders roster beyond authority, no template
 * management UI. Those land in later quests once the read surface
 * is stable.
 */
export default function IncorporationPage({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = useMemo(() => entities.find((e) => e.id === trustId), [entities, trustId]);
  const trustAddress = entity?.trust_address ?? null;

  const { trust, modules, isLoading, error } = useIncorporation(trustAddress);

  // ── Pre-bridge state: entity exists but has no on-chain mirror yet.
  if (!trustAddress) {
    return (
      <Page>
        <PageHeader title="Incorporation" description="The TRUST's constitutional surface." />
        <PageBody>
          <EmptyState
            title="Not yet on-chain"
            description="This entity does not have a TRUST proxy address yet. Once the click-to-DAO bridge fires, the on-chain Trust account and its adopted modules will render here."
          />
        </PageBody>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="Incorporation" description="The TRUST's constitutional surface." />
        <PageBody>
          <Loading variant="section" label="Reading on-chain Trust state" />
        </PageBody>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageHeader title="Incorporation" description="The TRUST's constitutional surface." />
        <PageBody>
          <EmptyState
            title="Couldn't read Trust state"
            description={error.message || "The RPC call to the configured Solana cluster failed."}
          />
        </PageBody>
      </Page>
    );
  }

  if (!trust) {
    return (
      <Page>
        <PageHeader title="Incorporation" description="The TRUST's constitutional surface." />
        <PageBody>
          <EmptyState
            title="Trust account not found"
            description={`No Trust account at ${shortAddress(trustAddress)} on the configured cluster. Check that the RPC URL matches the cluster the TRUST was deployed to.`}
          />
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Incorporation" description="The TRUST's constitutional surface." />
      <PageBody>
        <IdentitySection trust={trust} trustAddress={trustAddress} />
        <ModulesSection modules={modules ?? []} />
        <TemplateSection />
        <FoundersSection authority={trust.authority.toBase58()} />
      </PageBody>
    </Page>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Sections                                                            */
/* ────────────────────────────────────────────────────────────────── */

function IdentitySection({ trust, trustAddress }: { trust: TrustAccount; trustAddress: string }) {
  const trustIdHex = useMemo(() => bytesToHex(trust.trustId), [trust.trustId]);
  const authority = trust.authority.toBase58();

  return (
    <PageSection title="Identity">
      <DetailField label="TRUST address">
        <CopyableMono full={trustAddress} display={shortAddress(trustAddress)} />
      </DetailField>
      <DetailField label="trust_id (bytes32)">
        <CopyableMono full={`0x${trustIdHex}`} display={`0x${shortHex(trustIdHex)}`} />
      </DetailField>
      <DetailField label="Authority">
        <CopyableMono full={authority} display={shortAddress(authority)} />
      </DetailField>
      <DetailField label="Modules adopted">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{trust.moduleCount}</span>
      </DetailField>
      <DetailField label="State">
        <span style={{ display: "inline-flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Badge variant={trust.paused ? "warning" : "success"} dot>
            {trust.paused ? "Paused" : "Active"}
          </Badge>
          <Badge variant={trust.creationMode ? "info" : "muted"}>
            {trust.creationMode ? "Creation mode" : "Finalized"}
          </Badge>
        </span>
      </DetailField>
    </PageSection>
  );
}

function ModulesSection({ modules }: { modules: ModuleAccountWithPda[] }) {
  const rows = useMemo(
    () =>
      [...modules].sort((a, b) =>
        moduleSortLabel(a.account).localeCompare(moduleSortLabel(b.account)),
      ),
    [modules],
  );

  const columns: Array<TableColumn<ModuleAccountWithPda>> = [
    {
      key: "program",
      header: "Program",
      cell: (row) => {
        const programId = row.account.programId.toBase58();
        const friendly = getAeqiProgramName(programId);
        return (
          <span style={{ display: "inline-flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontWeight: 500 }}>{friendly ?? "external"}</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
              }}
            >
              {shortAddress(programId)}
            </span>
          </span>
        );
      },
    },
    {
      key: "moduleId",
      header: "Module ID",
      cell: (row) => (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
          }}
        >
          {moduleIdLabel(row.account.moduleId)}
        </span>
      ),
    },
    {
      key: "version",
      header: "Version",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {row.account.implementationVersion.toString()}
        </span>
      ),
    },
    {
      key: "acl",
      header: "ACL",
      align: "end",
      cell: (row) => (
        <Tooltip content="Module → TRUST permission bitmask. Symbolic flags land with the role-graph rewrite.">
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
            {row.account.trustAcl.toString()}
          </span>
        </Tooltip>
      ),
    },
    {
      key: "provider",
      header: "Provider",
      cell: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          {shortAddress(row.account.provider.toBase58())}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (row) => (
        <Badge variant={row.account.initialized ? "success" : "muted"} size="sm" dot>
          {row.account.initialized ? "Initialized" : "Pending"}
        </Badge>
      ),
    },
  ];

  return (
    <PageSection
      title="Modules"
      description="Programs the TRUST has adopted to implement its protocol slots."
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        empty={
          <EmptyState
            title="No modules adopted"
            description="When this TRUST adopts a module implementation, it lands here."
          />
        }
        ariaLabel="Adopted modules"
      />
    </PageSection>
  );
}

function TemplateSection() {
  // Founding template — deferred. `entity.template_id` is not currently
  // surfaced on the `/api/entities` payload, so the platform-DB read the
  // brief calls for has no input. When the platform widens the response,
  // swap this placeholder for the template link.
  return (
    <PageSection title="Founding template">
      <EmptyState
        title="Template metadata not yet surfaced"
        description="The blueprint this TRUST was founded from will render here once /api/entities exposes the entity's template_id."
      />
    </PageSection>
  );
}

function FoundersSection({ authority }: { authority: string }) {
  return (
    <PageSection title="Founders" description="The on-chain authority that registered this TRUST.">
      <DetailField label="Authority signer">
        <CopyableMono full={authority} display={shortAddress(authority)} />
      </DetailField>
      <EmptyState
        title="Full founders roster awaits Roles canonicalization"
        description="The chain-canonical role graph (quest ja-001.9) replaces the legacy founders list with the live authority DAG. Until then, only the registering authority is shown."
      />
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ────────────────────────────────────────────────────────────────── */

function CopyableMono({ full, display }: { full: string; display: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(full);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip content={copied ? "Copied" : "Copy"}>
      <span
        role="button"
        tabIndex={0}
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleCopy(e);
        }}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          cursor: "pointer",
        }}
      >
        {display}
        {copied ? " ✓" : ""}
      </span>
    </Tooltip>
  );
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function shortHex(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

/**
 * Anchor returns `[u8; 32]` fields as either a `Uint8Array` or a plain
 * number[] depending on the IDL parser version. Handle both shapes.
 */
function bytesToHex(bytes: Uint8Array | number[]): string {
  const iter = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = "";
  for (const b of iter) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Module IDs are 32-byte `pad32(prefix)` sentinels — the AEQI-defined
 * ones start with one or a few ASCII bytes ("R", "T", "G", "U") and
 * then zero-pad. Render the ASCII prefix when present so the canonical
 * modules read cleanly, falling back to a hex preview.
 */
function moduleIdLabel(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let asciiLen = 0;
  for (const b of arr) {
    if (b === 0) break;
    // printable ASCII range
    if (b >= 0x20 && b <= 0x7e) {
      asciiLen += 1;
      continue;
    }
    asciiLen = 0;
    break;
  }
  if (asciiLen > 0 && asciiLen <= 16) {
    const decoder = new TextDecoder("ascii");
    return decoder.decode(arr.slice(0, asciiLen));
  }
  return `0x${bytesToHex(arr).slice(0, 12)}…`;
}

function moduleSortLabel(account: { programId: { toBase58(): string } }): string {
  return getAeqiProgramName(account.programId.toBase58()) ?? "zzz";
}
