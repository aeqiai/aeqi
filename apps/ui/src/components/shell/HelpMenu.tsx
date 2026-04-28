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

const HelpIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M6 6.25c0-1.1 0.9-2 2-2s2 0.9 2 2c0 1.5-2 1.5-2 3" />
    <circle cx="8" cy="11.6" r="0.55" fill="currentColor" stroke="none" />
  </svg>
);

const KeyboardIcon = () => (
  <svg {...iconProps}>
    <rect x="1.5" y="4" width="13" height="8" rx="1" />
    <path d="M4 7h.01M7 7h.01M10 7h.01M13 7h.01M4 10h8" />
  </svg>
);

const DocsIcon = () => (
  <svg {...iconProps}>
    <path d="M3.5 2.5h7l2 2v9h-9z" />
    <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
  </svg>
);

export default function HelpMenu() {
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  const items: MenuItem[] = [
    {
      key: "shortcuts",
      label: "Keyboard shortcuts",
      icon: <KeyboardIcon />,
      onSelect: () => window.dispatchEvent(new CustomEvent("aeqi:open-shortcuts")),
    },
    {
      key: "docs",
      label: "Documentation",
      icon: <DocsIcon />,
      onSelect: () => window.open("https://aeqi.ai/docs", "_blank", "noopener,noreferrer"),
    },
  ];

  const trigger = (
    <button
      type="button"
      className="sidebar-row-action-btn"
      aria-label="Help"
      title={`Help — shortcuts, docs (${isMac ? "⌘" : "Ctrl"}/?)`}
    >
      <HelpIcon />
    </button>
  );

  return <Menu trigger={trigger} items={items} placement="top-end" />;
}
