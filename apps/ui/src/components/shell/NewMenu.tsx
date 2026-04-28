import { useNavigate } from "react-router-dom";
import { useUIStore } from "@/store/ui";
import { Menu } from "@/components/ui/Menu";
import type { MenuItem } from "@/components/ui/Menu";

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const PlusIcon = () => (
  <svg {...iconProps}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const CompanyIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="7" width="10" height="7" rx="0.5" />
    <path d="M1 7h14" />
    <path d="M6 7V4l2-2 2 2v3" />
  </svg>
);

const AgentIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
  </svg>
);

export default function NewMenu() {
  const navigate = useNavigate();
  const activeEntity = useUIStore((s) => s.activeEntity);

  const items: MenuItem[] = [
    {
      key: "company",
      label: "+ Company",
      icon: <CompanyIcon />,
      onSelect: () => navigate("/start"),
    },
    {
      key: "agent",
      label: "+ Agent",
      icon: <AgentIcon />,
      onSelect: () =>
        navigate(activeEntity ? `/new?parent=${encodeURIComponent(activeEntity)}` : "/new"),
    },
    {
      key: "quest",
      label: "+ Quest",
      icon: (
        <svg {...iconProps}>
          <path d="M4 2v12" />
          <path d="M4 3h7l-2 2.5L11 8H4z" />
        </svg>
      ),
      disabled: true,
      onSelect: () => {},
    },
    {
      key: "idea",
      label: "+ Idea",
      icon: (
        <svg {...iconProps}>
          <path d="M5 7a3 3 0 0 1 6 0c0 1.5-1 2.5-1 3.5h-4c0-1-1-2-1-3.5z" />
          <path d="M6.5 12h3M7 14h2" />
        </svg>
      ),
      disabled: true,
      onSelect: () => {},
    },
  ];

  const trigger = (
    <button type="button" className="sidebar-nav-item new-menu-trigger" aria-label="Create new">
      <PlusIcon />
      <span className="sidebar-nav-label">New</span>
    </button>
  );

  return <Menu trigger={trigger} items={items} placement="bottom-start" />;
}
