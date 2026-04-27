import { useNavigate } from "react-router-dom";
import { Popover } from "@/components/ui/Popover";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ChevronUpIcon = () => (
  <svg {...iconProps} width={10} height={10}>
    <path d="M4 10l4-4 4 4" />
  </svg>
);

const AccountIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
  </svg>
);

const InboxIcon = () => (
  <svg {...iconProps}>
    <path d="M2 8.5 4 3h8l2 5.5v4.5H2z" />
    <path d="M2 8.5h3.5l1 1.5h3l1-1.5H14" />
  </svg>
);

const BillingIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="4" width="12" height="9" rx="1" />
    <path d="M2 7h12" />
    <path d="M5 10.5h3" />
  </svg>
);

const SignOutIcon = () => (
  <svg {...iconProps}>
    <path d="M9 3H3v10h6" />
    <path d="M7 8h7M11 5l3 3-3 3" />
  </svg>
);

export default function AccountDropdown() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const logout = useAuthStore((s) => s.logout);

  const userName =
    user?.name || user?.email?.split("@")[0] || (authMode === "none" ? "Local" : "You");
  const userEmail = user?.name && user?.email ? user.email : null;

  const trigger = (
    <button type="button" className="account-dropdown-trigger" aria-label="Account menu">
      <span className="account-dropdown-avatar">
        <UserAvatar name={userName} size={16} src={user?.avatar_url} />
      </span>
      <span className="account-dropdown-identity">
        <span className="account-dropdown-name">{userName}</span>
        {userEmail && (
          <span className="account-dropdown-email" title={userEmail}>
            {userEmail}
          </span>
        )}
      </span>
      <span className="account-dropdown-chevron" aria-hidden="true">
        <ChevronUpIcon />
      </span>
    </button>
  );

  return (
    <Popover trigger={trigger} placement="top-start" portal>
      <div className="account-dropdown-menu">
        {authMode !== "none" && (
          <>
            <button
              type="button"
              className="account-dropdown-item"
              onClick={() => navigate("/settings")}
            >
              <span className="account-dropdown-item-icon" aria-hidden="true">
                <AccountIcon />
              </span>
              <span>Account</span>
            </button>
            <button type="button" className="account-dropdown-item" onClick={() => navigate("/")}>
              <span className="account-dropdown-item-icon" aria-hidden="true">
                <InboxIcon />
              </span>
              <span>Personal Inbox</span>
            </button>
            <button
              type="button"
              className="account-dropdown-item account-dropdown-item--disabled"
              disabled
              title="Coming soon"
            >
              <span className="account-dropdown-item-icon" aria-hidden="true">
                <svg {...iconProps}>
                  <path d="M8 2a2 2 0 0 1 2 2v.5c1.5.5 2.5 2 2.5 3.5H3.5C3.5 6.5 4.5 5 6 4.5V4a2 2 0 0 1 2-2z" />
                  <path d="M5.5 12a2.5 2.5 0 0 0 5 0" />
                </svg>
              </span>
              <span>Notifications</span>
              <span className="account-dropdown-item-soon">soon</span>
            </button>
            <button
              type="button"
              className="account-dropdown-item account-dropdown-item--disabled"
              disabled
              title="Coming soon"
            >
              <span className="account-dropdown-item-icon" aria-hidden="true">
                <svg {...iconProps}>
                  <rect x="2" y="2" width="5" height="5" rx="0.5" />
                  <rect x="9" y="2" width="5" height="5" rx="0.5" />
                  <rect x="2" y="9" width="5" height="5" rx="0.5" />
                  <rect x="9" y="9" width="5" height="5" rx="0.5" />
                </svg>
              </span>
              <span>Portfolio</span>
              <span className="account-dropdown-item-soon">soon</span>
            </button>
            <button
              type="button"
              className="account-dropdown-item"
              onClick={() => navigate("/settings/billing")}
            >
              <span className="account-dropdown-item-icon" aria-hidden="true">
                <BillingIcon />
              </span>
              <span>Billing</span>
            </button>
            <div className="account-dropdown-divider" role="separator" />
            <button
              type="button"
              className="account-dropdown-item account-dropdown-item--destructive"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <span className="account-dropdown-item-icon" aria-hidden="true">
                <SignOutIcon />
              </span>
              <span>Log out</span>
            </button>
          </>
        )}
        {authMode === "none" && (
          <div className="account-dropdown-item account-dropdown-item--label">Local mode</div>
        )}
      </div>
    </Popover>
  );
}
