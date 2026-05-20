import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Plus } from "lucide-react";
import { Popover, SelectOption } from "@/components/ui";
import TrustAvatar from "@/components/TrustAvatar";
import { useEntities, useActiveEntity } from "@/queries/entities";
import { useUIStore } from "@/store/ui";
import { entityPath } from "@/lib/entityPath";
import type { Trust } from "@/lib/types";

const ChevronDownIcon = () => <ChevronDown size={10} />;
const PlusIcon = () => <Plus size={12} />;

/**
 * Top-of-rail workspace switcher. The user can be in two contexts:
 *
 * - **User scope** (`/`, `/account`, `/account/<sub>`, `/launch`,
 *   `/sessions/<id>`): the trigger renders the user's avatar + name; launch
 *   and account settings live here.
 * - **Trust scope** (anything under `/trust/<trust_address>/...`): the
 *   trigger renders the active organization's avatar + name.
 *
 * The dropdown always carries three groups: the user themselves (so
 * pivoting from a company back to "yourself" is one click), every
 * organization they own, and a "+ New organization" affordance. With zero
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

  // Trust scope = `/trust/<addr>/...`.
  const isEntityScope = pathname.startsWith("/trust/");

  const select = useCallback(
    (entity: Trust) => {
      setActiveEntity(entity.id);
      // Navigate to the canonical URL for the entity — /trust/<addr>.
      navigate(entityPath(entity));
      setOpen(false);
    },
    [navigate, setActiveEntity],
  );

  const createCompany = useCallback(() => {
    navigate("/launch");
    setOpen(false);
  }, [navigate]);

  // Trigger label is sticky to the active workspace. Going to
  // `/account` from inside `/c/acme` shouldn't make the switcher
  // flip — Acme is still the user's current workspace; the URL just
  // put them on the user-scoped account surface. When there's no
  // active workspace (brand-new user, or it got cleared), the
  // trigger reads as a clear placeholder — "Select an organization" — so
  // the user knows the dropdown is the next move.
  const triggerEntity = activeEntity ?? null;
  const triggerLabel = triggerEntity?.name ?? "Select an organization";
  const triggerAvatar = triggerEntity ? (
    <TrustAvatar name={triggerEntity.name} size={16} />
  ) : (
    <span className="company-switcher-avatar-empty" aria-hidden="true" />
  );

  const trigger = (
    <button
      type="button"
      className={`company-switcher-trigger${
        triggerEntity ? "" : " company-switcher-trigger--empty"
      }`}
      aria-label={triggerEntity ? "Switch workspace" : "Select an organization"}
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
  const ordered: Trust[] = displayEntity
    ? [displayEntity, ...entities.filter((e) => e.id !== displayEntity.id)]
    : entities;

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} placement="bottom-start" portal>
      <div className="company-switcher-menu" role="menu">
        {/* Three layers: a quiet eyebrow naming what the menu is, the
            list of workspaces (current + owned), and the create CTA
            sitting in its own footer band. Personal-scope navigation
            (Inbox, Portfolio) lives in the sidebar above; the switcher
            is purely a workspace picker. */}
        <div className="company-switcher-eyebrow">Select organization</div>
        <div className="company-switcher-list">
          {ordered.map((entity) => {
            const isCurrent = isEntityScope && entity.id === activeEntityId;
            return (
              <SelectOption
                key={entity.id}
                selected={isCurrent}
                noIndicator
                onClick={() => select(entity)}
                leadingIcon={<TrustAvatar name={entity.name} size={16} />}
              >
                {entity.name}
              </SelectOption>
            );
          })}
        </div>
        <div className="company-switcher-footer">
          <SelectOption
            selected={false}
            onClick={createCompany}
            leadingIcon={<PlusIcon />}
            className="company-switcher-create"
          >
            Launch a new organization
          </SelectOption>
        </div>
      </div>
    </Popover>
  );
}
