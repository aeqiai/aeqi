import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Popover, SelectOption } from "@/components/ui";
import BlockAvatar from "@/components/BlockAvatar";
import UserAvatar from "@/components/UserAvatar";
import { useEntities, useActiveEntity } from "@/queries/entities";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import type { Entity } from "@/lib/types";

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ChevronDownIcon = () => (
  <svg {...iconProps} width={10} height={10}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

const PlusIcon = () => (
  <svg {...iconProps} width={12} height={12}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

/**
 * Top-of-rail switcher. Two scopes:
 *
 * - **User scope** (`/`, `/me`, `/me/<sub>`, `/economy`, `/economy/<sub>`):
 *   trigger renders the user's avatar + name. The dropdown still lists
 *   companies — picking one navigates into `/c/<entity_id>`.
 * - **Entity scope** (anything under `/c/<entity_id>/...`): trigger
 *   renders the active company's avatar + name.
 *
 * If the user has exactly one company AND we're at entity scope on that
 * company, the trigger renders as a static label (no chevron, no
 * dropdown) — there's nothing to switch to. The "+ New company"
 * affordance lives in the global "+ New" menu next to the switcher.
 *
 * If the user has zero companies, the dropdown collapses to a single
 * "+ New company" entry — only reachable at user scope (entity scope
 * isn't routable without an entity).
 */
export default function CompanySwitcher() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const entities = useEntities();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeEntity = useActiveEntity(activeEntityId);
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const [open, setOpen] = useState(false);

  // Entity scope = `/c/<entity_id>/...`. Everything else (`/`, `/me/...`,
  // `/economy/...`, `/start`, `/sessions/<id>`) is user scope.
  const isEntityScope = pathname.startsWith("/c/");
  const isUserScope = !isEntityScope;

  const userName =
    user?.name || user?.email?.split("@")[0] || (authMode === "none" ? "Local" : "You");

  const select = useCallback(
    (entity: Entity) => {
      setActiveEntity(entity.id);
      navigate(`/c/${encodeURIComponent(entity.id)}`);
      setOpen(false);
    },
    [navigate, setActiveEntity],
  );

  const createCompany = useCallback(() => {
    navigate("/start");
    setOpen(false);
  }, [navigate]);

  // Single-company at entity scope: the switcher has nothing to switch
  // between. Render a static label, no popover — keeps the rail honest
  // and the trigger non-interactive when a click would be a no-op.
  const onlyCompanyShown =
    isEntityScope &&
    entities.length === 1 &&
    activeEntity?.id === entities[0].id &&
    activeEntityId === entities[0].id;

  if (onlyCompanyShown && activeEntity) {
    // No popover, no chevron — there's nothing to switch between, so the
    // trigger downgrades to a static label using the same trigger styles
    // (avatar + name) without the chevron or button affordance.
    return (
      <div
        className="company-switcher-trigger company-switcher-trigger--static"
        aria-label="Active company"
      >
        <span className="company-switcher-avatar">
          <BlockAvatar name={activeEntity.name} size={16} />
        </span>
        <span className="company-switcher-name">{activeEntity.name}</span>
      </div>
    );
  }

  // Trigger label: user identity at user scope, active-company at
  // entity scope. The dropdown contents are scope-independent — same
  // list of companies + create affordance everywhere.
  const triggerLabel = isUserScope
    ? userName
    : (activeEntity?.name ?? entities[0]?.name ?? "Company");
  const triggerAvatar = isUserScope ? (
    <UserAvatar name={userName} size={16} src={user?.avatar_url} />
  ) : (
    <BlockAvatar name={triggerLabel} size={16} />
  );

  const trigger = (
    <button
      type="button"
      className="company-switcher-trigger"
      aria-label={isUserScope ? "Open company switcher" : "Switch company"}
    >
      <span className="company-switcher-avatar">{triggerAvatar}</span>
      <span className="company-switcher-name">{triggerLabel}</span>
      <span className="company-switcher-chevron" aria-hidden="true">
        <ChevronDownIcon />
      </span>
    </button>
  );

  // Order entities so the active one is first when at entity scope.
  // At user scope the order is the entities list as returned — no
  // "active" company in that view.
  const displayEntity = isEntityScope ? (activeEntity ?? entities[0] ?? null) : null;
  const ordered: Entity[] = displayEntity
    ? [displayEntity, ...entities.filter((e) => e.id !== displayEntity.id)]
    : entities;

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} placement="bottom-start" portal>
      <div className="company-switcher-menu" role="menu">
        {ordered.map((entity) => {
          const isCurrent = isEntityScope && entity.id === activeEntityId;
          return (
            <SelectOption
              key={entity.id}
              selected={isCurrent}
              noIndicator
              onClick={() => select(entity)}
              leadingIcon={<BlockAvatar name={entity.name} size={16} />}
            >
              {entity.name}
            </SelectOption>
          );
        })}
        <SelectOption selected={false} onClick={createCompany} leadingIcon={<PlusIcon />}>
          New company
        </SelectOption>
      </div>
    </Popover>
  );
}
