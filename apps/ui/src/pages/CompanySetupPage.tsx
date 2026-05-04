import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Blueprint } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { Button, Spinner } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import { FOUNDER_FEE } from "@/lib/pricing";
import {
  WizardIdentityPanel,
  WizardRolesPanel,
  WizardTokenPanel,
  WizardVestingPanel,
  WizardGovernancePanel,
  WizardReviewPanel,
  slugify,
} from "@/components/wizard";
import type {
  IdentityState,
  RoleSeat,
  InviteRow,
  TokenState,
  VestingState,
  GovernanceState,
  WizardState,
} from "@/components/wizard";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";
import "@/styles/wizard.css";

/**
 * `/start/:slug` — company setup wizard.
 *
 * Sits between picking a Blueprint and the actual spawn so the operator
 * configures six panels in one scrollable flow:
 *
 *   Identity → Roles → Token → Vesting → Governance → Review
 *
 * Panels are collapsible sections, not modal steps. Default state is
 * collapsed showing the auto-filled summary; "Configure" header toggle
 * expands all at once. Panels only render when the blueprint has the
 * relevant module (Token / Vesting / Governance hidden for personal-os).
 *
 * Submit logic is deferred — the Create company CTA in Review stays
 * disabled until WS-1 (role encoder) + WS-9 (IPFS upload) land.
 */

/** True when the blueprint is "personal-os" — stripped wizard variant. */
function isPersonalOs(blueprint: Blueprint): boolean {
  return blueprint.slug === "personal-os";
}

/**
 * Derive initial role seats from the blueprint.
 * - For personal-os: single Owner row with the user.
 * - For everything else: seed_roles map to seats; founder role(s)
 *   assigned to the user, agent seats assigned to their seed_agent.
 */
function deriveSeats(blueprint: Blueprint, userId: string | null): RoleSeat[] {
  if (isPersonalOs(blueprint)) {
    return [
      {
        key: "owner",
        title: "Owner",
        roleType: "founder",
        occupant: userId ? `user:${userId}` : "user:me",
        addressPlaceholder: "0x... — provisioned at create",
      },
    ];
  }

  if (!blueprint.seed_roles || blueprint.seed_roles.length === 0) {
    // Fallback: create a single Founder seat for the user + agent seats for seed_agents
    const seats: RoleSeat[] = [
      {
        key: "founder",
        title: "Founder",
        roleType: "founder",
        occupant: userId ? `user:${userId}` : "user:me",
        addressPlaceholder: "0x... — provisioned at create",
      },
    ];
    for (const agent of blueprint.seed_agents ?? []) {
      seats.push({
        key: agent.name.toLowerCase().replace(/\s+/g, "-"),
        title: agent.name,
        roleType: "worker",
        occupant: `agent:${agent.name}`,
        addressPlaceholder: null,
      });
    }
    return seats;
  }

  return blueprint.seed_roles.map((r) => {
    const isFounder = r.key === "founder" || r.title.toLowerCase().includes("founder");
    const isDirector = r.key === "director" || r.title.toLowerCase().includes("director");
    const isHumanSlot = isFounder || isDirector;
    const roleType = isFounder ? "founder" : isDirector ? "director" : "worker";

    return {
      key: r.key,
      title: r.title,
      roleType,
      occupant: isHumanSlot
        ? userId
          ? `user:${userId}`
          : "user:me"
        : `agent:${r.default_occupant_agent ?? r.title}`,
      addressPlaceholder: isHumanSlot ? "0x... — provisioned at create" : null,
    };
  });
}

/** True for blueprints that should show Token / Vesting / Governance panels. */
function hasOnchainModules(blueprint: Blueprint): boolean {
  return !isPersonalOs(blueprint);
}

function deriveDefaultToken(blueprint: Blueprint): TokenState {
  const companyName = blueprint.root?.name ?? blueprint.name;
  const symbol = companyName
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 4)
    .toUpperCase();
  return {
    name: `${companyName} Token`,
    symbol,
    maxSupply: "100000000",
  };
}

const DEFAULT_VESTING: VestingState = {
  schedules: [
    { roleType: "Founder", durationYears: "4", cliffMonths: "12" },
    { roleType: "Director", durationYears: "4", cliffMonths: "12" },
    { roleType: "Worker", durationYears: "2", cliffMonths: "6" },
  ],
};

const DEFAULT_GOVERNANCE: GovernanceState = {
  votingPeriodDays: "7",
  quorumPct: "50",
  proposalThresholdPct: "1",
};

type PanelId = "identity" | "roles" | "token" | "vesting" | "governance" | "review";

export default function CompanySetupPage() {
  const navigate = useNavigate();
  const { slug = "" } = useParams<{ slug: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const userName = useAuthStore((s) => s.user?.name ?? "You");
  const subscriptionStatus = useAuthStore((s) => s.user?.subscription_status ?? null);
  const isAdmin = useAuthStore((s) => s.user?.is_admin === true);
  const isInvited = subscriptionStatus === "invited";
  const skipsStripe = isInvited || isAdmin;

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Wizard state ─────────────────────────────────────────────────
  const [identity, setIdentity] = useState<IdentityState>({
    name: "",
    tagline: "",
    slug: "",
  });
  const [seats, setSeats] = useState<RoleSeat[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [token, setToken] = useState<TokenState | null>(null);
  const [vesting, setVesting] = useState<VestingState | null>(null);
  const [governance, setGovernance] = useState<GovernanceState | null>(null);

  // ── Panel expand/collapse state ──────────────────────────────────
  const [expandedPanels, setExpandedPanels] = useState<Set<PanelId>>(new Set());

  function togglePanel(id: PanelId) {
    setExpandedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function expandAll() {
    const ids: PanelId[] = ["identity", "roles", "token", "vesting", "governance", "review"];
    setExpandedPanels(new Set(ids));
  }

  function collapseAll() {
    setExpandedPanels(new Set());
  }

  const allExpanded = expandedPanels.size >= (blueprint && hasOnchainModules(blueprint) ? 6 : 3);

  useEffect(() => {
    document.title = blueprint?.name ? `Set up ${blueprint.name} · aeqi` : "Set up · aeqi";
  }, [blueprint?.name]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getBlueprint(slug)
      .then((resp) => {
        if (cancelled) return;
        if (resp.blueprint) {
          const bp = resp.blueprint;
          setBlueprint(bp);

          // Seed wizard state from blueprint defaults
          const name = bp.root?.name ?? bp.name;
          const tagline = bp.tagline ?? "";
          setIdentity({ name, tagline, slug: slugify(name) });
          setSeats(deriveSeats(bp, userId));

          if (hasOnchainModules(bp)) {
            setToken(deriveDefaultToken(bp));
            setVesting(DEFAULT_VESTING);
            setGovernance(DEFAULT_GOVERNANCE);
          } else {
            setToken(null);
            setVesting(null);
            setGovernance(null);
          }
        } else {
          setLoadError("Blueprint not found.");
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message || "Could not reach the blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, userId]);

  if (loading && !blueprint) {
    return (
      <div className="wizard-page">
        <div className="bp-status">
          <Spinner size="sm" /> Loading blueprint…
        </div>
      </div>
    );
  }

  if (!blueprint) {
    return (
      <div className="wizard-page">
        <EmptyState
          title="Blueprint not found."
          description={loadError || "We couldn't find a blueprint with that slug."}
          action={
            <Button variant="secondary" onClick={() => navigate("/blueprints")}>
              Back to catalog
            </Button>
          }
        />
      </div>
    );
  }

  const personal = isPersonalOs(blueprint);
  const onchain = hasOnchainModules(blueprint);

  const wizardState: WizardState = {
    identity,
    seats,
    invites,
    token: onchain ? token : null,
    vesting: onchain ? vesting : null,
    governance: onchain ? governance : null,
  };

  return (
    <div className="wizard-page">
      {/* ── Page header ─────────────────────────────── */}
      <header className="wizard-head">
        <p className="wizard-eyebrow">Set up · {blueprint.name}</p>
        <h1 className="wizard-title">Configure your company.</h1>
        <p className="wizard-sub">{blueprint.tagline || "Review and configure, then create."}</p>
      </header>

      {/* ── Top CTA row ─────────────────────────────── */}
      <div className="wizard-cta-row">
        <Button
          variant="primary"
          disabled
          title="WS-1 (role encoder) + WS-9 (IPFS) must land first"
        >
          {skipsStripe ? "Create company" : `Create company — $${FOUNDER_FEE} today`}
        </Button>
        <button
          type="button"
          className="wizard-configure-toggle"
          onClick={allExpanded ? collapseAll : expandAll}
        >
          {allExpanded ? "Collapse all" : "Configure"}
        </button>
      </div>

      {/* ── Panel stack ─────────────────────────────── */}
      <div className="wizard-panels">
        <WizardIdentityPanel
          state={identity}
          onChange={setIdentity}
          expanded={expandedPanels.has("identity")}
          onToggle={() => togglePanel("identity")}
        />

        <WizardRolesPanel
          blueprint={blueprint}
          userId={userId}
          userName={userName}
          seats={seats}
          invites={invites}
          onSeatsChange={setSeats}
          onInvitesChange={setInvites}
          expanded={expandedPanels.has("roles")}
          onToggle={() => togglePanel("roles")}
          personalOs={personal}
        />

        {onchain && token && (
          <WizardTokenPanel
            state={token}
            onChange={setToken}
            expanded={expandedPanels.has("token")}
            onToggle={() => togglePanel("token")}
          />
        )}

        {onchain && vesting && (
          <WizardVestingPanel
            state={vesting}
            onChange={setVesting}
            expanded={expandedPanels.has("vesting")}
            onToggle={() => togglePanel("vesting")}
          />
        )}

        {onchain && governance && (
          <WizardGovernancePanel
            state={governance}
            onChange={setGovernance}
            expanded={expandedPanels.has("governance")}
            onToggle={() => togglePanel("governance")}
          />
        )}

        <WizardReviewPanel
          state={wizardState}
          expanded={expandedPanels.has("review")}
          onToggle={() => togglePanel("review")}
        />
      </div>

      {/* ── Footer nav ──────────────────────────────── */}
      <div className="wizard-foot">
        <Button
          variant="secondary"
          onClick={() => navigate(`/blueprints/${encodeURIComponent(blueprint.slug)}`)}
        >
          Back to blueprint
        </Button>
      </div>
    </div>
  );
}
