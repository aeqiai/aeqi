import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useVisibleIdeas } from "@/queries/ideas";
import { useQuests } from "@/queries/quests";
import { useNav } from "@/hooks/useNav";
import { formatMediumDate } from "@/lib/i18n";
import type { Idea, Quest } from "@/lib/types";

import "@/styles/roadmap.css";

/**
 * Roadmap tab — temporal join over Goals (Ideas[kind=goal]) and
 * Projects (Quests[kind=project]). Phase 2.1 of ae-002.
 *
 * Each Goal renders as an outer bar; each Project renders as an inner
 * bar nested under its parent Goal (via `quest.idea_id` pointing at the
 * Goal) or as an unparented Project bar at the bottom.
 *
 * Time window defaults to (today - 1 month) → (today + 6 months) but
 * stretches to include any item whose deadline falls outside it. A
 * vertical "today" marker keeps the present orientable.
 *
 * Phase 2.1 scope:
 *   - Linear timeline with month gridlines
 *   - Bars positioned by created_at → deadline
 *   - Click a bar → navigate to its entity detail page
 *
 * Out of scope:
 *   - Drag-to-reschedule (Phase 2.2+)
 *   - Dependency arrows (deferred — Linear-shape, expensive to render)
 *   - Zoom controls (deferred — fixed window covers 99% of cases)
 */
export default function EntityRoadmapTab({ entityId: _entityId }: { entityId: string }) {
  const ideasQuery = useVisibleIdeas();
  const quests = useQuests();
  const navigate = useNavigate();
  const { entityId } = useNav();

  const goals = useMemo(
    () => (ideasQuery.data ?? []).filter((i: Idea) => (i.kind ?? "note") === "goal"),
    [ideasQuery.data],
  );
  const projects = useMemo(
    () => quests.filter((q: Quest) => (q.kind ?? "task") === "project"),
    [quests],
  );

  const { windowStart, windowEnd, totalMs } = useMemo(
    () => computeWindow(goals, projects),
    [goals, projects],
  );

  const goalRows = useMemo(() => groupProjectsUnderGoals(goals, projects), [goals, projects]);
  const today = new Date();
  const todayPct = pctInWindow(today, windowStart, windowEnd);
  const monthMarkers = useMemo(() => monthGrid(windowStart, windowEnd), [windowStart, windowEnd]);

  if (goals.length === 0 && projects.length === 0) {
    return (
      <section className="roadmap-tab">
        <header className="roadmap-tab__header">
          <h1 className="roadmap-tab__title">Roadmap</h1>
          <p className="roadmap-tab__subtitle">
            Goals and Projects plotted on a timeline. Set a Goal or start a Project to populate this
            view.
          </p>
        </header>
        <div className="roadmap-tab__empty">
          <p>Nothing on the timeline yet. Goals and Projects with deadlines will appear here.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="roadmap-tab">
      <header className="roadmap-tab__header">
        <h1 className="roadmap-tab__title">Roadmap</h1>
        <p className="roadmap-tab__subtitle">
          Goals and Projects on a timeline.{" "}
          <span className="roadmap-tab__window">
            {formatMediumDate(windowStart)} – {formatMediumDate(windowEnd)}
          </span>
        </p>
      </header>

      <div
        className="roadmap-canvas"
        role="region"
        aria-label={`Roadmap from ${windowStart.toISOString()} to ${windowEnd.toISOString()}`}
      >
        <div className="roadmap-canvas__grid" aria-hidden>
          {monthMarkers.map((m) => (
            <div key={m.iso} className="roadmap-canvas__month" style={{ left: `${m.pct}%` }}>
              <span className="roadmap-canvas__month-label">{m.label}</span>
              <span className="roadmap-canvas__month-tick" />
            </div>
          ))}
          {todayPct >= 0 && todayPct <= 100 && (
            <div
              className="roadmap-canvas__today"
              style={{ left: `${todayPct}%` }}
              title={`Today: ${formatMediumDate(today)}`}
            >
              <span className="roadmap-canvas__today-label">Today</span>
            </div>
          )}
        </div>

        <div className="roadmap-canvas__rows">
          {goalRows.map((row) => (
            <RoadmapRow
              key={row.goal.id}
              goal={row.goal}
              projects={row.projects}
              windowStart={windowStart}
              totalMs={totalMs}
              onGoalClick={() => navigate(`/trust/${entityId}/goals`)}
              onProjectClick={(p) => navigate(`/trust/${entityId}/quests/${p.id}`)}
            />
          ))}
          {goalRows.length > 0 && goalRows[goalRows.length - 1].projects.length > 0 && (
            <div className="roadmap-row-sep" aria-hidden />
          )}
          {projects.filter((p) => !p.idea_id || !goals.some((g) => g.id === p.idea_id)).length >
            0 && (
            <UnparentedProjectsRow
              projects={projects.filter(
                (p) => !p.idea_id || !goals.some((g) => g.id === p.idea_id),
              )}
              windowStart={windowStart}
              totalMs={totalMs}
              onProjectClick={(p) => navigate(`/trust/${entityId}/quests/${p.id}`)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

interface GoalRow {
  goal: Idea;
  projects: Quest[];
}

function groupProjectsUnderGoals(goals: Idea[], projects: Quest[]): GoalRow[] {
  const byGoal = new Map<string, Quest[]>();
  for (const p of projects) {
    if (!p.idea_id) continue;
    if (!goals.some((g) => g.id === p.idea_id)) continue;
    const arr = byGoal.get(p.idea_id) ?? [];
    arr.push(p);
    byGoal.set(p.idea_id, arr);
  }
  // Sort goals by their deadline (properties.deadline), then by name.
  const sortedGoals = [...goals].sort((a, b) => {
    const da = goalDeadline(a)?.getTime() ?? Infinity;
    const db = goalDeadline(b)?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return (a.name || "").localeCompare(b.name || "");
  });
  return sortedGoals.map((g) => ({ goal: g, projects: byGoal.get(g.id) ?? [] }));
}

function goalDeadline(goal: Idea): Date | null {
  const props = (goal.properties ?? {}) as Record<string, unknown>;
  const raw = typeof props.deadline === "string" ? props.deadline : null;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function goalStart(goal: Idea): Date {
  if (goal.created_at) {
    const d = new Date(goal.created_at);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function projectStart(project: Quest): Date {
  if (project.created_at) {
    const d = new Date(project.created_at);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function projectEnd(project: Quest): Date | null {
  if (project.due_at) {
    const d = new Date(project.due_at);
    if (!isNaN(d.getTime())) return d;
  }
  if (project.closed_at) {
    const d = new Date(project.closed_at);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function computeWindow(goals: Idea[], projects: Quest[]) {
  const today = new Date();
  let start = new Date(today);
  start.setMonth(start.getMonth() - 1);
  let end = new Date(today);
  end.setMonth(end.getMonth() + 6);

  for (const g of goals) {
    const gs = goalStart(g);
    const gd = goalDeadline(g);
    if (gs && gs < start) start = gs;
    if (gd && gd > end) end = gd;
  }
  for (const p of projects) {
    const ps = projectStart(p);
    const pe = projectEnd(p);
    if (ps && ps < start) start = ps;
    if (pe && pe > end) end = pe;
  }

  // Round to month boundaries for a tidy grid.
  const windowStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const windowEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  const totalMs = windowEnd.getTime() - windowStart.getTime();
  return { windowStart, windowEnd, totalMs };
}

function pctInWindow(d: Date, windowStart: Date, windowEnd: Date): number {
  const total = windowEnd.getTime() - windowStart.getTime();
  if (total <= 0) return 0;
  return ((d.getTime() - windowStart.getTime()) / total) * 100;
}

interface MonthMarker {
  iso: string;
  label: string;
  pct: number;
}

function monthGrid(windowStart: Date, windowEnd: Date): MonthMarker[] {
  const out: MonthMarker[] = [];
  const cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
  while (cur <= windowEnd) {
    out.push({
      iso: cur.toISOString(),
      label:
        cur.toLocaleString("en-US", { month: "short" }) +
        (cur.getMonth() === 0 ? ` '${String(cur.getFullYear()).slice(2)}` : ""),
      pct: pctInWindow(cur, windowStart, windowEnd),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function RoadmapRow({
  goal,
  projects,
  windowStart,
  totalMs,
  onGoalClick,
  onProjectClick,
}: {
  goal: Idea;
  projects: Quest[];
  windowStart: Date;
  totalMs: number;
  onGoalClick: () => void;
  onProjectClick: (project: Quest) => void;
}) {
  const start = goalStart(goal);
  const deadline = goalDeadline(goal);
  const props = (goal.properties ?? {}) as Record<string, unknown>;
  const status = typeof props.status === "string" ? props.status : "active";

  const startPct = ((start.getTime() - windowStart.getTime()) / totalMs) * 100;
  const endPct = deadline
    ? ((deadline.getTime() - windowStart.getTime()) / totalMs) * 100
    : Math.min(100, startPct + 10);
  const widthPct = Math.max(2, endPct - startPct);

  return (
    <div className="roadmap-row roadmap-row--goal">
      <div className="roadmap-row__label" title={goal.name}>
        <span className="roadmap-row__glyph" aria-hidden>
          ◎
        </span>
        <span className="roadmap-row__name">{goal.name || "(untitled goal)"}</span>
      </div>
      <div className="roadmap-row__track">
        <button
          type="button"
          className={`roadmap-bar roadmap-bar--goal roadmap-bar--status-${status}`}
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
          onClick={onGoalClick}
          title={deadline ? `${goal.name} — by ${formatMediumDate(deadline)}` : goal.name}
        >
          <span className="roadmap-bar__label">{goal.name}</span>
        </button>
        {projects.map((p) => (
          <ProjectBar
            key={p.id}
            project={p}
            windowStart={windowStart}
            totalMs={totalMs}
            onClick={() => onProjectClick(p)}
            nested
          />
        ))}
      </div>
    </div>
  );
}

function ProjectBar({
  project,
  windowStart,
  totalMs,
  onClick,
  nested,
}: {
  project: Quest;
  windowStart: Date;
  totalMs: number;
  onClick: () => void;
  nested?: boolean;
}) {
  const start = projectStart(project);
  const end = projectEnd(project) ?? new Date(start.getTime() + 1000 * 60 * 60 * 24 * 14);
  const startPct = ((start.getTime() - windowStart.getTime()) / totalMs) * 100;
  const endPct = ((end.getTime() - windowStart.getTime()) / totalMs) * 100;
  const widthPct = Math.max(2, endPct - startPct);
  const label = project.idea?.name ?? project.id;

  return (
    <button
      type="button"
      className={`roadmap-bar roadmap-bar--project roadmap-bar--status-${project.status}${
        nested ? " roadmap-bar--nested" : ""
      }`}
      style={{ left: `${startPct}%`, width: `${widthPct}%` }}
      onClick={onClick}
      title={project.due_at ? `${label} — by ${formatMediumDate(new Date(project.due_at))}` : label}
    >
      <span className="roadmap-bar__label">{label}</span>
    </button>
  );
}

function UnparentedProjectsRow({
  projects,
  windowStart,
  totalMs,
  onProjectClick,
}: {
  projects: Quest[];
  windowStart: Date;
  totalMs: number;
  onProjectClick: (p: Quest) => void;
}) {
  return (
    <div className="roadmap-row roadmap-row--orphan">
      <div className="roadmap-row__label" title="Projects not linked to a Goal">
        <span className="roadmap-row__glyph" aria-hidden>
          ☰
        </span>
        <span className="roadmap-row__name">Standalone projects</span>
      </div>
      <div className="roadmap-row__track">
        {projects.map((p) => (
          <ProjectBar
            key={p.id}
            project={p}
            windowStart={windowStart}
            totalMs={totalMs}
            onClick={() => onProjectClick(p)}
          />
        ))}
      </div>
    </div>
  );
}
