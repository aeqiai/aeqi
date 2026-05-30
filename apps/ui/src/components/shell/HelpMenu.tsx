import { CircleHelp, Keyboard, FileText } from "lucide-react";
import { Icon, Menu, Tooltip } from "@/components/ui";
import type { MenuItem } from "@/components/ui/Menu";

const HelpIcon = () => <Icon icon={CircleHelp} />;
const KeyboardIcon = () => <Icon icon={Keyboard} size="sm" />;
const DocsIcon = () => <Icon icon={FileText} size="sm" />;

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
    <Tooltip content={`Help — shortcuts, docs (${isMac ? "⌘" : "Ctrl"}/?)`}>
      <button
        type="button"
        className="sidebar-row-action-btn"
        aria-label="Help"
        data-pill-allowed=""
      >
        <HelpIcon />
      </button>
    </Tooltip>
  );

  return <Menu trigger={trigger} items={items} placement="top-end" />;
}
