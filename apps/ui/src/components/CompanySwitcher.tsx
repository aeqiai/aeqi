import { useNavigate } from "react-router-dom";
import { useUIStore } from "@/store/ui";
import BlockAvatar from "./BlockAvatar";

export default function CompanySwitcher() {
  const activeCompany = useUIStore((s) => s.activeCompany);
  const navigate = useNavigate();

  const displayName = activeCompany || "Select company";

  return (
    <div className="co-switcher">
      <div
        className="co-trigger"
        role="button"
        tabIndex={0}
        aria-label={`Switch company, current: ${displayName}`}
        onClick={() => navigate("/")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate("/");
          }
        }}
      >
        <span className="co-brand">
          <BlockAvatar name={displayName} size={22} />
        </span>
        <div className="co-trigger-text">
          <span className="co-trigger-name">{displayName}</span>
        </div>
        <svg
          className="co-chevron-icon"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          style={{ opacity: 0.2 }}
        >
          <path d="M4 3l2-1.5L8 3" />
          <path d="M4 9l2 1.5L8 9" />
        </svg>
      </div>
    </div>
  );
}
