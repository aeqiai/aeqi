import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Popover, SelectOption } from "@/components/ui";
import BlockAvatar from "@/components/BlockAvatar";
import { useEntities, useActiveEntity } from "@/queries/entities";
import { useUIStore } from "@/store/ui";
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
  const [open, setOpen] = useState(false);

  // Entity scope = `/c/<entity_id>/...`. Everything else (`/`, `/me/...`,
  // `/economy/...`, `/start`, `/sessions/<id>`) is user scope.
  const isEntityScope = pathname.startsWith("/c/");

  const select = useCallback(
    (entity: Entity) => {
      setActiveEntity(entity.id);
      // Selecting a company lands on its Overview — the canonical
      // company dashboard. The bare `/c/<id>` URL redirects there
      // anyway, but going straight is faster + avoids a redirect
      // round-trip.
      navigate(`/c/${encodeURIComponent(entity.id)}/overview`);
      setOpen(false);
    },
    [navigate, setActiveEntity],
  );

  const createCompany = useCallback(() => {
    navigate("/start");
    setOpen(false);
  }, [navigate]);

  // Trigger label is sticky to the active workspace. Going to
  // `/me/inbox` from inside `/c/acme` shouldn't make the switcher
  // flip — Acme is still the user's current workspace; the URL just
  // put them in a personal lens. When there's no active workspace
  // (brand-new user, or it got cleared), the trigger reads as a
  // clear placeholder — "Select a company" — so the user knows the
  // dropdown is the next move.
  const triggerEntity = activeEntity ?? null;
  const triggerLabel = triggerEntity?.name ?? "Select a company";
  const triggerAvatar = triggerEntity ? (
    <BlockAvatar name={triggerEntity.name} size={16} />
  ) : (
    <span className="company-switcher-avatar-empty" aria-hidden="true" />
  );

  const trigger = (
    <button
      type="button"
      className={`company-switcher-trigger${
        triggerEntity ? "" : " company-switcher-trigger--empty"
      }`}
      aria-label={triggerEntity ? "Switch workspace" : "Select a company"}
    >
      <span className="company-switcher-avatar">{triggerAvatar}</span>
      <span className="company-switcher-name">{triggerLabel}</span>
      <span className="company-switcher-chevron" aria-hidden="true">
        <ChevronDownIcon />
      </span>
    </button>
  );

  // Active entity floats to the top of the list so the user's current
  // workspace is the first row in the dropdown — one click to return
  // to it from `/me/*` or any other user-scope surface.
  const displayEntity = activeEntity ?? null;
  const ordered: Entity[] = displayEntity
    ? [displayEntity, ...entities.filter((e) => e.id !== displayEntity.id)]
    : entities;

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} placement="bottom-start" portal>
      <div className="company-switcher-menu" role="menu">
        {/* The switcher is a workspace picker — companies + create.
            Personal-scope navigation (Home, Inbox) lives in the
            sidebar above the switcher; clicking those is how the
            user leaves company context. Adding a "you" entry here
            would be a redundant third path with confused semantics. */}
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
