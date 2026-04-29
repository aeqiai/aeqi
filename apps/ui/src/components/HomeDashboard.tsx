import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useEntitiesQuery } from "@/queries/entities";
import { useAuthStore } from "@/store/auth";
import { useInboxStore, selectInboxCount } from "@/store/inbox";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "still up";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  if (h < 22) return "good evening";
  return "welcome back";
}

function firstName(name: string | undefined, email: string | undefined): string | null {
  const raw = name || email?.split("@")[0] || "";
  if (!raw) return null;
  const seg = raw.split(/[\s._-]+/)[0];
  if (!seg) return null;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/**
 * Home — root `/` landing.
 *
 * First-time users (zero companies) are redirected to `/start` — the
 * single launch surface. Returning users see the director inbox intro.
 */
export default function HomeDashboard() {
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const entitiesQuery = useEntitiesQuery();
  const entities = entitiesQuery.data ?? [];

  useEffect(() => {
    document.title = "home · æqi";
  }, []);

  const name = firstName(user?.name, user?.email);
  const greet = greeting();
  const heading = name ? `${greet}, ${name}` : greet;

  // Wait for the entity query to load before deciding zero-state vs returning
  // — otherwise the redirect can fire on stale empty state.
  if (entitiesQuery.isLoading && !entitiesQuery.isFetched) return null;

  if (entities.length === 0) {
    const blueprintParam = searchParams.get("blueprint");
    const startUrl = blueprintParam
      ? `/start?blueprint=${encodeURIComponent(blueprintParam)}`
      : "/start";
    return <Navigate to={startUrl} replace />;
  }

  // Returning user — the home page is the director inbox's intro. The
  // sessions rail (left of this column) carries the actual list of
  // awaiting items; this column is just the greeting and a one-line
  // status. No list, no composer — picking a row from the rail loads
  // /sessions/:id and the conversation renders here.
  return <InboxIntro heading={heading} />;
}

function InboxIntro({ heading }: { heading: string }) {
  const inboxCount = useInboxStore(selectInboxCount);
  const status =
    inboxCount === 0
      ? "Nothing awaiting your input."
      : inboxCount === 1
        ? "1 awaiting your input."
        : `${inboxCount} awaiting your input.`;

  return (
    <div className="home home-inbox-intro">
      <header className="home-inbox-hero">
        <h1 className="home-inbox-greeting">{heading}.</h1>
        <p className="home-inbox-status">{status}</p>
      </header>
    </div>
  );
}
