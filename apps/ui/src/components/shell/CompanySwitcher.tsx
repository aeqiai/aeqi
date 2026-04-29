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
 * Top-of-rail workspace switcher. The user can be in two contexts:
 *
 * - **User scope** (`/`, `/me`, `/me/<sub>`, `/economy`, `/economy/<sub>`,
 *   `/sessions/<id>`, `/start`): the trigger renders the user's avatar
 *   + name; the inbox / personal economy / settings live here.
 * - **Entity scope** (anything under `/c/<entity_id>/...`): the trigger
 *   renders the active company's avatar + name.
 *
 * The dropdown always carries three groups: the user themselves (so
 * pivoting from a company back to "yourself" is one click), every
 * company they own, and a "+ New company" affordance. With zero
 * companies the user entry + create entry are the only items, and the
 * trigger is still a popover — the create path is always visible.
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

  const goToUserScope = useCallback(() => {
    navigate("/");
    setOpen(false);
  }, [navigate]);

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} placement="bottom-start" portal>
      <div className="company-switcher-menu" role="menu">
        {/* "You" — the user's own scope. Their inbox lives at `/`,
             personal economy / settings at `/me`, and the active
             company is just a filter applied inside those views. From
             this entry the user pivots out of any company context back
             to their own. */}
        <SelectOption
          selected={isUserScope}
          noIndicator
          onClick={goToUserScope}
          leadingIcon={<UserAvatar name={userName} size={16} src={user?.avatar_url} />}
        >
          {userName}
        </SelectOption>
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
