import { useNavigate, useLocation } from "react-router-dom";
import { useUIStore } from "@/store/ui";
import BlockAvatar from "./BlockAvatar";

export default function WorkspaceSwitcher() {
  const activeCompany = useUIStore((s) => s.activeCompany);
  const navigate = useNavigate();
  const location = useLocation();

  const displayName = activeCompany || "aeqi";
  const isOnEntities = location.pathname === "/companies";

  return (
    <div className="ws-switcher">
      <div
        className="ws-trigger"
        role="button"
        tabIndex={0}
        aria-label={`Switch workspace, current: ${displayName}`}
        onClick={() => navigate("/companies")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate("/companies");
          }
        }}
      >
        <span className="ws-brand">
          <BlockAvatar name={displayName} size={22} />
        </span>
        <div className="ws-trigger-text">
          <span className="ws-trigger-name">{displayName}</span>
        </div>
        <svg
          className="ws-chevron-icon"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          style={{ opacity: isOnEntities ? 0.5 : 0.2 }}
        >
          <path d="M4 3l2-1.5L8 3" />
          <path d="M4 9l2 1.5L8 9" />
        </svg>
      </div>
    </div>
  );
}
