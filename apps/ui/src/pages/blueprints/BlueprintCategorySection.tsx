import { blueprintId } from "@/lib/blueprintId";
import type { BlueprintCategory, SingleBlueprint } from "@/lib/types";
import { BlueprintCard } from "@/components/blueprints/BlueprintCard";
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  V1_SHIPPED_COMPANY_PACKAGE_COUNT,
  type View,
} from "./constants";

export interface BlueprintCategorySectionProps {
  category: BlueprintCategory;
  blueprints: SingleBlueprint[];
  view: View;
  importTargetSuffix: string;
  isActiveFilter: boolean;
  onCategoryFilter: () => void;
  onNavigate: (path: string) => void;
}

export default function BlueprintCategorySection({
  category,
  blueprints,
  view,
  importTargetSuffix,
  isActiveFilter,
  onCategoryFilter,
  onNavigate,
}: BlueprintCategorySectionProps) {
  const label = CATEGORY_LABELS[category];
  const description = CATEGORY_DESCRIPTIONS[category];
  const count = blueprints.length;
  const isEmpty = count === 0;

  return (
    <section
      className={`bp-category-section${isActiveFilter ? " bp-category-section--active" : ""}`}
    >
      <header className="bp-category-header">
        <div className="bp-category-header-main">
          <button
            type="button"
            className={`bp-category-name${isActiveFilter ? " active" : ""}`}
            onClick={onCategoryFilter}
            title={isActiveFilter ? `Show all categories` : `Filter to ${label}`}
          >
            {label}
          </button>
          <span className="bp-category-count">{count}</span>
          <span className="bp-category-desc">{description}</span>
        </div>
      </header>

      {isEmpty ? (
        <div className="bp-category-empty">
          {category === "company"
            ? "No launchable company packages match the current filters."
            : "Not shipped in v1. Draft archetypes stay hidden until audited."}
        </div>
      ) : view === "list" ? (
        <ul className="bp-list" role="list">
          {blueprints.map((t) => (
            <li key={blueprintId(t)} className="bp-list-row">
              <button
                type="button"
                className="bp-list-row-btn"
                onClick={() =>
                  onNavigate(
                    `/blueprints/${encodeURIComponent(blueprintId(t))}${importTargetSuffix}`,
                  )
                }
              >
                <span className="bp-list-row-name">{t.name}</span>
                {t.tagline && <span className="bp-list-row-tagline">{t.tagline}</span>}
                <span className="bp-list-row-counts">
                  Launch package · {t.template ?? "entity"} · {(t.seed_agents?.length ?? 0) + 1}{" "}
                  agents
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="bp-grid" role="list">
          {blueprints.map((t) => (
            <BlueprintCard
              key={blueprintId(t)}
              template={t}
              importTargetSuffix={importTargetSuffix}
              shippedLimit={V1_SHIPPED_COMPANY_PACKAGE_COUNT}
            />
          ))}
        </div>
      )}
    </section>
  );
}
