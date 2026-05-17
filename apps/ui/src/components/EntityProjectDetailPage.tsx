import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuests } from "@/queries/quests";
import { useNav } from "@/hooks/useNav";
import { formatMediumDate } from "@/lib/i18n";
import { Button } from "@/components/ui";
import type { Quest } from "@/lib/types";

import "@/styles/detail-pages.css";

/**
 * Project detail page — `/trust/<addr>/projects/<questId>` (Phase 2.2
 * of ae-002). Shows the Project header + Work board (child Quests via
 * `metadata.parent_id === project.id`).
 *
 * Phase 2.2 ships the minimum viable detail: header + work board +
 * back link. Plan tab (attached Ideas), Files tab, Decisions tab, and
 * the project Discussion thread are Phase 2.2.1+.
 *
 * Routing: dispatched from CompanyPage when `tab === "projects"`
 * AND `itemId` is present.
 */
export default function EntityProjectDetailPage({
  entityId: _entityId,
  projectId,
}: {
  entityId: string;
  projectId: string;
}) {
  const quests = useQuests();
  const navigate = useNavigate();
  const { entityId } = useNav();

  const project = useMemo(() => quests.find((q: Quest) => q.id === projectId), [quests, projectId]);
  const childQuests = useMemo(
    () => quests.filter((q: Quest) => (q.metadata?.parent_id ?? null) === projectId),
    [quests, projectId],
  );

  if (!project) {
    return (
      <section className="detail-page">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/trust/${entityId}/projects`)}>
          ← Back to Projects
        </Button>
        <div className="detail-page__empty">
          <p>Project {projectId} not found in this entity.</p>
        </div>
      </section>
    );
  }

  const title = project.idea?.name ?? project.id;
  const summary = project.idea?.content ?? "";
  const status = project.status;
  const dueAt = project.due_at;
  const cost = project.cost_usd;
  const done = childQuests.filter((q) => q.status === "done").length;
  const pct = childQuests.length > 0 ? Math.round((done / childQuests.length) * 100) : null;

  return (
    <section className="detail-page">
      <div className="detail-page__breadcrumb">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/trust/${entityId}/projects`)}>
          ← Back to Projects
        </Button>
      </div>

      <header className="detail-page__header">
        <h1 className="detail-page__title">{title}</h1>
        <div className="detail-page__chips">
          <span
            className={`detail-page__chip detail-page__chip--status detail-page__chip--status-${status}`}
          >
            {status}
          </span>
          {dueAt && (
            <span className="detail-page__chip detail-page__chip--deadline">
              by {formatMediumDate(new Date(dueAt))}
            </span>
          )}
          {pct !== null && (
            <span className="detail-page__chip detail-page__chip--rollup">
              {pct}% · {done}/{childQuests.length}
            </span>
          )}
          {cost > 0 && (
            <span className="detail-page__chip detail-page__chip--cost">${cost.toFixed(2)}</span>
          )}
        </div>
        {summary && <p className="detail-page__summary">{summary}</p>}
        {pct !== null && (
          <div className="detail-page__progress">
            <div className="detail-page__progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
      </header>

      <section className="detail-page__section">
        <h2 className="detail-page__section-title">Work</h2>
        {childQuests.length === 0 ? (
          <p className="detail-page__empty-note">
            No sub-Quests yet. Atomic work units land here when they're spawned with
            <code> metadata.parent_id = "{projectId}"</code>.
          </p>
        ) : (
          <ul className="detail-page__work-list">
            {childQuests.map((q) => (
              <li
                key={q.id}
                className={`detail-page__work-row detail-page__work-row--status-${q.status}`}
              >
                <button
                  type="button"
                  className="detail-page__work-link"
                  onClick={() => navigate(`/trust/${entityId}/quests/${q.id}`)}
                >
                  <span className={`detail-page__work-dot detail-page__work-dot--${q.status}`} />
                  <span className="detail-page__work-name">{q.idea?.name ?? q.id}</span>
                  <span className="detail-page__work-status">{q.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
