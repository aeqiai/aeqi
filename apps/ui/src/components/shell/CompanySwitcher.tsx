import { useNavigate } from "react-router-dom";
import { Popover } from "@/components/ui/Popover";
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

const CheckIcon = () => (
  <svg viewBox="0 0 12 12" width={10} height={10} fill="none">
    <path
      d="M2.5 6.5l2.5 2.5 4.5-5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
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

  const displayName = activeEntity?.name ?? (entities.length > 0 ? entities[0].name : "Company");
  const displayEntity = activeEntity ?? entities[0] ?? null;

  const ordered: Entity[] = displayEntity
    ? [displayEntity, ...entities.filter((e) => e.id !== displayEntity.id)]
    : entities;

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
    <Popover trigger={trigger} placement="bottom-start" portal>
      <div className="company-switcher-menu">
        {ordered.map((entity) => {
          const isCurrent = entity.id === activeEntityId;
          return (
            <button
              key={entity.id}
              type="button"
              className={`company-switcher-item${isCurrent ? " active" : ""}`}
              onClick={() => {
                setActiveEntity(entity.id);
                navigate(`/${encodeURIComponent(entity.id)}`);
              }}
            >
              <span className="company-switcher-item-avatar">
                <BlockAvatar name={entity.name} size={16} />
              </span>
              <span className="company-switcher-item-name">{entity.name}</span>
              {isCurrent && (
                <span className="company-switcher-item-check" aria-hidden="true">
                  <CheckIcon />
                </span>
              )}
            </button>
          );
        })}
        <div className="company-switcher-footer">
          <button
            type="button"
            className="company-switcher-footer-btn"
            onClick={() => navigate("/start")}
          >
            <span className="company-switcher-footer-icon" aria-hidden="true">
              <PlusIcon />
            </span>
            <span>New company</span>
          </button>
        </div>
      </div>
    </Popover>
  );
}
