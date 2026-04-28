import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Popover, SelectOption } from "@/components/ui";
import BlockAvatar from "@/components/BlockAvatar";
import { useEntities, useActiveEntity } from "@/store/daemon";
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

export default function CompanySwitcher() {
  const navigate = useNavigate();
  const entities = useEntities();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeEntity = useActiveEntity(activeEntityId);
  const [open, setOpen] = useState(false);

  const displayName = activeEntity?.name ?? (entities.length > 0 ? entities[0].name : "Company");
  const displayEntity = activeEntity ?? entities[0] ?? null;

  const ordered: Entity[] = displayEntity
    ? [displayEntity, ...entities.filter((e) => e.id !== displayEntity.id)]
    : entities;

  const select = useCallback(
    (entity: Entity) => {
      setActiveEntity(entity.id);
      navigate(`/${encodeURIComponent(entity.id)}`);
      setOpen(false);
    },
    [navigate, setActiveEntity],
  );

  const createCompany = useCallback(() => {
    navigate("/start");
    setOpen(false);
  }, [navigate]);

  const trigger = (
    <button type="button" className="company-switcher-trigger" aria-label="Switch company">
      <span className="company-switcher-avatar">
        <BlockAvatar name={displayName} size={16} />
      </span>
      <span className="company-switcher-name">{displayName}</span>
      <span className="company-switcher-chevron" aria-hidden="true">
        <ChevronDownIcon />
      </span>
    </button>
  );

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} placement="bottom-start" portal>
      <div className="company-switcher-menu" role="menu">
        {ordered.map((entity) => {
          const isCurrent = entity.id === activeEntityId;
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
