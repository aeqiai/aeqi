import { useMemo, useState } from "react";
import type { BlueprintSeedView } from "@/lib/types";
import {
  EmptyKind,
  NoMatch,
  SeedSearch,
} from "@/components/blueprints/BlueprintSeedListPrimitives";

const EMPTY_SEED_VIEWS: BlueprintSeedView[] = [];

export function BlueprintViewsSection({ seeds }: { seeds?: BlueprintSeedView[] }) {
  const [query, setQuery] = useState("");
  const all = seeds ?? EMPTY_SEED_VIEWS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (view) =>
        view.label.toLowerCase().includes(q) ||
        view.key.toLowerCase().includes(q) ||
        view.path.toLowerCase().includes(q) ||
        (view.search ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);

  if (all.length === 0) return <EmptyKind label="views" />;
  return (
    <>
      <SeedSearch query={query} onChange={setQuery} placeholder="Search views" />
      {filtered.length === 0 ? (
        <NoMatch query={query} />
      ) : (
        <ul className="bp-seed-list" role="list">
          {filtered.map((view) => {
            const route = `${view.path}${view.search ?? ""}`;
            return (
              <li key={view.key} className="bp-seed-row">
                <div className="bp-seed-row-head">
                  <span className="bp-seed-row-name">{view.label}</span>
                  <span className="bp-seed-row-meta">{view.pinned ? "pinned" : "saved"}</span>
                </div>
                <p className="bp-seed-row-sub">{route}</p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
