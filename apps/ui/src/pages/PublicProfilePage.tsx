import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import TrustHeroStrip from "@/components/TrustHeroStrip";
import { Button, EmptyState, Loading } from "@/components/ui";

/**
 * Public profile page — Phase 2 of public-profiles. Renders at the
 * top-level URL `<host>/<slug>` where `<slug>` is the trust_id
 * UUID. Reads from the unauth `/api/public/entities/<slug>` endpoint;
 * 404s when the entity is not marked `public=true` (or doesn't exist —
 * the public-read endpoint deliberately doesn't distinguish, so private
 * workspaces stay invisible to probers).
 *
 * Uses `<TrustHeroStrip public />` in read-only mode for the hero so
 * the surface stays consistent with the in-shell Overview rail.
 *
 * No follow / DM / messaging affordances on this surface — Phase 3+.
 */

interface PublicRole {
  id: string;
  title: string;
  role_type: string;
  occupant_kind: "human" | "agent" | "vacant" | string;
  occupant_name: string | null;
  occupant_avatar_url: string | null;
}

interface PublicIdea {
  id: string;
  title: string;
  summary: string;
  tags: string[];
}

interface PublicProfile {
  trust_id: string;
  display_name: string;
  tagline: string | null;
  public: true;
  roles: PublicRole[];
  ideas: PublicIdea[];
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; profile: PublicProfile }
  | { status: "not_found" }
  | { status: "error"; message: string };

export default function PublicProfilePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/public/entities/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setState({ status: "not_found" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error", message: `HTTP ${res.status}` });
          return;
        }
        const profile = (await res.json()) as PublicProfile;
        setState({ status: "ready", profile });
      } catch (e) {
        if (cancelled) return;
        setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === "loading") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-2)",
          minHeight: "100vh",
          color: "var(--color-text-muted)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        <Loading size="sm" />
        Loading profile…
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-6)",
        }}
      >
        <EmptyState
          eyebrow="404"
          title="Profile not found"
          description="This Company doesn't exist or hasn't published a public profile."
          action={
            <Button variant="primary" onClick={() => navigate("/")}>
              Start a Company
            </Button>
          }
        />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-6)",
        }}
      >
        <EmptyState
          eyebrow="Error"
          title="Couldn't load this profile"
          description={state.message}
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const { profile } = state;
  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "var(--space-6)",
        minHeight: "100vh",
      }}
    >
      <TrustHeroStrip
        trustId={profile.trust_id}
        public
        publicEntity={{
          display_name: profile.display_name,
          tagline: profile.tagline,
        }}
      />

      <PublicRolesSection roles={profile.roles} />
      <PublicIdeasSection ideas={profile.ideas} />

      <PublicProfileFooter
        onSignIn={() => navigate(`/login?next=${encodeURIComponent(`/${slug}`)}`)}
        onStart={() => navigate("/signup")}
      />
    </main>
  );
}

function PublicRolesSection({ roles }: { roles: PublicRole[] }) {
  if (roles.length === 0) return null;
  return (
    <section
      aria-label="Public roles"
      style={{ margin: "var(--space-6) 0", paddingTop: "var(--space-4)" }}
    >
      <h2
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 600,
          margin: "0 0 var(--space-4) 0",
          color: "var(--color-text-primary)",
        }}
      >
        Roles
      </h2>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {roles.map((role) => (
          <li
            key={role.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-3) var(--space-4)",
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <RoleAvatar role={role} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                }}
              >
                {role.title}
              </div>
              <div
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--color-text-muted)",
                }}
              >
                {role.occupant_kind === "vacant"
                  ? "Vacant"
                  : (role.occupant_name ?? role.occupant_kind)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleAvatar({ role }: { role: PublicRole }) {
  const size = 32;
  if (role.occupant_avatar_url) {
    return (
      <img
        src={role.occupant_avatar_url}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
          background: "var(--color-bg-subtle)",
          flexShrink: 0,
        }}
      />
    );
  }
  // Initial-letter fallback for humans/agents without an avatar URL, neutral
  // grey circle for vacant.
  const initial = (role.occupant_name ?? role.title).slice(0, 1).toUpperCase();
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: "var(--color-bg-subtle)",
        color: "var(--color-text-muted)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function PublicIdeasSection({ ideas }: { ideas: PublicIdea[] }) {
  if (ideas.length === 0) return null;
  return (
    <section
      aria-label="Public ideas"
      style={{ margin: "var(--space-6) 0", paddingTop: "var(--space-4)" }}
    >
      <h2
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 600,
          margin: "0 0 var(--space-4) 0",
          color: "var(--color-text-primary)",
        }}
      >
        Ideas
      </h2>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {ideas.map((idea) => (
          <li
            key={idea.id}
            style={{
              padding: "var(--space-3) var(--space-4)",
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div
              style={{
                fontSize: "var(--font-size-sm)",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              {idea.title || "Untitled"}
            </div>
            {idea.summary && (
              <div
                style={{
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-text-secondary)",
                  marginTop: "var(--space-1)",
                }}
              >
                {idea.summary}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PublicProfileFooter({ onSignIn, onStart }: { onSignIn: () => void; onStart: () => void }) {
  return (
    <footer
      style={{
        marginTop: "var(--space-8)",
        paddingTop: "var(--space-6)",
        display: "flex",
        gap: "var(--space-3)",
        flexWrap: "wrap",
        alignItems: "center",
        color: "var(--color-text-muted)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      <Button variant="primary" onClick={onStart}>
        Start a Company
      </Button>
      <Button variant="secondary" onClick={onSignIn}>
        Sign in
      </Button>
    </footer>
  );
}
