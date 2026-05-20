import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import type {
  BlueprintCategory,
  BlueprintSeedAgent,
  BlueprintSeedEvent,
  BlueprintSeedIdea,
  BlueprintSeedQuest,
  SingleBlueprint,
} from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, Loading } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import PageRail from "@/components/PageRail";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

type Section = "overview" | "roles" | "agents" | "events" | "quests" | "ideas";

const CATEGORY_LABELS: Record<BlueprintCategory, string> = {
  company: "Company",
  foundation: "Foundation",
  fund: "Fund",
};

const SECTION_TABS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "roles", label: "Roles" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
];
const SECTION_IDS = SECTION_TABS.map((t) => t.id);
const EMPTY_SEED_AGENTS: BlueprintSeedAgent[] = [];
const EMPTY_SEED_EVENTS: BlueprintSeedEvent[] = [];
const EMPTY_SEED_QUESTS: BlueprintSeedQuest[] = [];
const EMPTY_SEED_IDEAS: BlueprintSeedIdea[] = [];

/**
 * `/blueprints/:blueprintId[/:section]` — inspect a Blueprint and explore its
 * seed primitives.
 *
 * Two-column shell mirrors the catalog and `/settings`: vertical
 * PageRail on the left (title = blueprint name; sections = Overview /
 * Agents / Events / Quests / Ideas), the right pane renders a slim
 * head band (back + launch CTA) followed by per-section content.
 *
 * Overview — tagline / description / tree / counts.
 * Agents / Events / Quests / Ideas — searchable list of the relevant
 * seeds with a "none found" empty state. v1 blueprints may not seed
 * every kind; the rail still surfaces all five so the navigation
 * shape is constant across blueprints.
 */
export default function BlueprintDetailPage() {
  const { blueprintId: blueprintIdParam = "", section } = useParams<{
    blueprintId: string;
    section?: string;
  }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const allAgents = useDaemonStore((s) => s.agents);

  const importIntoId = searchParams.get("import_into") || null;
  const importTarget = useMemo(
    () => (importIntoId ? allAgents.find((a) => a.id === importIntoId) || null : null),
    [allAgents, importIntoId],
  );
  const isImportMode = !!importIntoId;

  const activeSection: Section = useMemo(() => {
    if (!section) return "overview";
    return SECTION_IDS.includes(section as Section) ? (section as Section) : "overview";
  }, [section]);

  const [template, setTemplate] = useState<SingleBlueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = "aeqi";
  }, []);

  useEffect(() => {
    if (!blueprintIdParam) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getBlueprint(blueprintIdParam)
      .then((resp) => {
        if (cancelled) return;
        const tpl = resp.blueprint;
        if (tpl) setTemplate(tpl);
        else setError("Blueprint not found.");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not reach the blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blueprintIdParam]);

  if (loading && !template) {
    return (
      <div className="page-rail-shell">
        <PageRail tabs={SECTION_TABS} defaultTab="overview" title="Blueprint" basePath="" />
        <main className="page-rail-content page-rail-content--full">
          <div className="bp-status">
            <Loading size="sm" /> Loading Blueprint…
          </div>
        </main>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="page-rail-shell">
        <PageRail tabs={SECTION_TABS} defaultTab="overview" title="Blueprint" basePath="" />
        <main className="page-rail-content page-rail-content--full">
          <EmptyState
            title="Blueprint not found."
            description={error || "We couldn't find a blueprint with that id."}
            action={<Link to="/blueprints">Back to the catalog →</Link>}
          />
        </main>
      </div>
    );
  }

  const single = template;

  // Detail page is preview-only. The launch CTA hands off to
  // `/launch/<blueprintId>` (TrustSetupPage) where the operator confirms a
  // name, stages role overrides, and picks a plan before spawn.
  const launchHref = isImportMode
    ? `/blueprints/${encodeURIComponent(blueprintId(single))}?import_into=${encodeURIComponent(importIntoId ?? "")}`
    : `/launch/${encodeURIComponent(blueprintId(single))}`;

  return (
    <div className="page-rail-shell">
      <PageRail
        tabs={SECTION_TABS}
        defaultTab="overview"
        title="Blueprint"
        basePath={`/blueprints/${encodeURIComponent(blueprintId(single))}`}
        currentValue={activeSection}
      />
      <main className="page-rail-content page-rail-content--full">
        <div className="ideas-list-head bp-detail-head">
          <div className="ideas-toolbar bp-detail-toolbar">
            <button
              type="button"
              className="ideas-toolbar-btn"
              onClick={() =>
                navigate(
                  single.category ? `/blueprints?category=${single.category}` : "/blueprints",
                )
              }
              title={
                single.category
                  ? `Back to ${CATEGORY_LABELS[single.category]} blueprints`
                  : "Back to Blueprints"
              }
              aria-label={
                single.category
                  ? `Back to ${CATEGORY_LABELS[single.category]} blueprints`
                  : "Back to Blueprints"
              }
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M8 3 L4.5 6.5 L8 10" />
              </svg>
            </button>
            {single.category && (
              <span className="bp-detail-breadcrumb">{CATEGORY_LABELS[single.category]}</span>
            )}
            <h1 className="bp-detail-toolbar-title">{single.name}</h1>
            {single.template && (
              <span className="bp-detail-template-badge" title="On-chain TRUST template">
                {single.template}
              </span>
            )}
            <div className="ideas-toolbar-spacer" aria-hidden />
            <Link to={launchHref} className="bp-detail-launch-link" aria-disabled={isImportMode}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isImportMode}
                onClick={(e) => {
                  if (isImportMode) e.preventDefault();
                }}
              >
                {isImportMode ? "Coming soon" : "Use this Blueprint →"}
              </Button>
            </Link>
          </div>
        </div>

        <div className="bp-detail-body">
          {isImportMode && (
            <div className="bp-import-banner" role="status">
              <span className="bp-import-banner-eyebrow">Import mode</span>
              <p className="bp-import-banner-line">
                Picking this Blueprint will merge its seed agents, ideas, events, and quests into{" "}
                <strong>{importTarget?.name || "the selected agent"}</strong>&rsquo;s tree once the
                server merge endpoint lands.
              </p>
            </div>
          )}

          {error && (
            <div className="bp-error" role="alert">
              {error} — showing the bundled copy.
            </div>
          )}

          {activeSection === "overview" && <OverviewSection template={single} />}
          {activeSection === "roles" && <RolesSection seeds={single.seed_agents} />}
          {activeSection === "agents" && <AgentsSection seeds={single.seed_agents} />}
          {activeSection === "events" && <EventsSection seeds={single.seed_events} />}
          {activeSection === "quests" && <QuestsSection seeds={single.seed_quests} />}
          {activeSection === "ideas" && <IdeasSection seeds={single.seed_ideas} />}
        </div>
      </main>
    </div>
  );
}

/* ── Overview ──────────────────────────────────────── */

function OverviewSection({ template }: { template: SingleBlueprint }) {
  return (
    <>
      {(template.tagline || template.description) && (
        <header className="bp-detail-page-head">
          {template.tagline && <p className="bp-detail-page-tagline">{template.tagline}</p>}
          {template.description && <p className="bp-detail-page-desc">{template.description}</p>}
        </header>
      )}

      {/* Stats sit directly under the hero — immediate information
          scent before the user digs into the org chart. Counts answer
          "what's in this Blueprint" at a glance: roles, default
          agents, ideas, events, quests. */}
      <BlueprintSeedCounts template={template} />

      <section className="bp-detail-section">
        <BlueprintTreePreview template={template} />
      </section>
    </>
  );
}

/* ── Searchable seed list (one shape, four kinds) ────── */

function SeedSearch({
  query,
  onChange,
  placeholder,
}: {
  query: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="ideas-toolbar">
      <span className="ideas-list-search-field">
        <svg
          className="ideas-list-search-glyph"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="5.2" cy="5.2" r="3.2" />
          <path d="M7.6 7.6 L10 10" />
        </svg>
        <input
          className="ideas-list-search"
          type="search"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={(e) => onChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="ideas-list-search-clear"
            onClick={() => onChange("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

function EmptyKind({ label }: { label: string }) {
  return (
    <EmptyState
      title={`No ${label} in this Blueprint.`}
      description="v1 blueprints ship sparse — not every Blueprint seeds every primitive."
    />
  );
}

function NoMatch({ query }: { query: string }) {
  return <EmptyState title={`No match for "${query}".`} />;
}

/**
 * Roles section. Lens onto the seed_agents list that emphasizes the
 * STRUCTURE — title primary, default occupant in the meta. The Agents
 * section below shows the identity lens (name + tagline + identity)
 * for the same data. Today the underlying source is one list because
 * the JSON conflates role+occupant; once the schema gains explicit
 * `seed_roles` + `seed_role_edges`, this lens reads from there.
 */
function RolesSection({ seeds }: { seeds?: BlueprintSeedAgent[] }) {
  const [query, setQuery] = useState("");
  const all = seeds ?? EMPTY_SEED_AGENTS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.tagline ?? "").toLowerCase().includes(q) ||
        (a.role ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);

  if (all.length === 0) return <EmptyKind label="roles" />;
  return (
    <>
      <SeedSearch query={query} onChange={setQuery} placeholder="Search roles" />
      {filtered.length === 0 ? (
        <NoMatch query={query} />
      ) : (
        <ul className="bp-seed-list" role="list">
          {filtered.map((a) => {
            const roleTitle = a.role || a.name;
            return (
              <li key={a.name} className="bp-seed-row">
                <div className="bp-seed-row-head">
                  <span className="bp-seed-row-name">{roleTitle}</span>
                  <span className="bp-seed-row-meta">default occupant · {a.name}</span>
                </div>
                {a.tagline && <p className="bp-seed-row-sub">{a.tagline}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Agents section. Lens onto the seed_agents list that emphasizes the
 * IDENTITY — agent name primary, the role they fill in the meta. Roles
 * are the WHERE; agents are the WHO. Both ship in every blueprint;
 * each role's default_occupant points at one of these agents.
 */
function AgentsSection({ seeds }: { seeds?: BlueprintSeedAgent[] }) {
  const [query, setQuery] = useState("");
  const all = seeds ?? EMPTY_SEED_AGENTS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.tagline ?? "").toLowerCase().includes(q) ||
        (a.role ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);

  if (all.length === 0) return <EmptyKind label="agents" />;
  return (
    <>
      <SeedSearch query={query} onChange={setQuery} placeholder="Search agents" />
      {filtered.length === 0 ? (
        <NoMatch query={query} />
      ) : (
        <ul className="bp-seed-list" role="list">
          {filtered.map((a) => (
            <li key={a.name} className="bp-seed-row">
              <div className="bp-seed-row-head">
                <span className="bp-seed-row-name">{a.name}</span>
                <span className="bp-seed-row-meta">{a.role ? `fills · ${a.role}` : "bench"}</span>
              </div>
              {a.tagline && <p className="bp-seed-row-sub">{a.tagline}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EventsSection({ seeds }: { seeds?: BlueprintSeedEvent[] }) {
  const [query, setQuery] = useState("");
  const all = seeds ?? EMPTY_SEED_EVENTS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) =>
        e.pattern.toLowerCase().includes(q) ||
        (e.name ?? "").toLowerCase().includes(q) ||
        (e.owner ?? "").toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);

  if (all.length === 0) return <EmptyKind label="events" />;
  return (
    <>
      <SeedSearch query={query} onChange={setQuery} placeholder="Search events" />
      {filtered.length === 0 ? (
        <NoMatch query={query} />
      ) : (
        <ul className="bp-seed-list" role="list">
          {filtered.map((e, i) => (
            <li key={`${e.pattern}-${i}`} className="bp-seed-row">
              <div className="bp-seed-row-head">
                <span className="bp-seed-row-pattern">{e.pattern}</span>
                {(e.owner || e.name) && (
                  <span className="bp-seed-row-meta">
                    {[e.owner, e.name].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              {e.description && <p className="bp-seed-row-sub">{e.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function QuestsSection({ seeds }: { seeds?: BlueprintSeedQuest[] }) {
  const [query, setQuery] = useState("");
  const all = seeds ?? EMPTY_SEED_QUESTS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (qu) =>
        qu.subject.toLowerCase().includes(q) ||
        (qu.owner ?? "").toLowerCase().includes(q) ||
        (qu.description ?? "").toLowerCase().includes(q) ||
        (qu.labels ?? []).some((label) => label.toLowerCase().includes(q)),
    );
  }, [all, query]);

  if (all.length === 0) return <EmptyKind label="quests" />;
  return (
    <>
      <SeedSearch query={query} onChange={setQuery} placeholder="Search quests" />
      {filtered.length === 0 ? (
        <NoMatch query={query} />
      ) : (
        <ul className="bp-seed-list" role="list">
          {filtered.map((q, i) => (
            <li key={`${q.subject}-${i}`} className="bp-seed-row">
              <div className="bp-seed-row-head">
                <span className="bp-seed-row-name">{q.subject}</span>
                {(q.owner || q.priority || (q.labels ?? []).length > 0) && (
                  <span className="bp-seed-row-meta">
                    {[q.owner, q.priority, ...(q.labels ?? []).slice(0, 2)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
              {q.description && <p className="bp-seed-row-sub">{q.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function IdeasSection({ seeds }: { seeds?: BlueprintSeedIdea[] }) {
  const [query, setQuery] = useState("");
  const all = seeds ?? EMPTY_SEED_IDEAS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.owner ?? "").toLowerCase().includes(q) ||
        (i.summary ?? "").toLowerCase().includes(q) ||
        (i.content ?? "").toLowerCase().includes(q) ||
        (i.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [all, query]);

  if (all.length === 0) return <EmptyKind label="ideas" />;
  return (
    <>
      <SeedSearch query={query} onChange={setQuery} placeholder="Search ideas" />
      {filtered.length === 0 ? (
        <NoMatch query={query} />
      ) : (
        <ul className="bp-seed-list" role="list">
          {filtered.map((i) => (
            <li key={i.name} className="bp-seed-row">
              <div className="bp-seed-row-head">
                <span className="bp-seed-row-name">{i.name}</span>
                {(i.owner || (i.tags ?? []).length > 0) && (
                  <span className="bp-seed-row-meta">
                    {[i.owner, ...(i.tags ?? []).slice(0, 3).map((t) => `#${t}`)]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                )}
              </div>
              {(i.summary || i.content) && (
                <p className="bp-seed-row-sub">{i.summary || i.content}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
