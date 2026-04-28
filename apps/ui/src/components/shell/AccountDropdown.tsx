import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Popover, SelectOption } from "@/components/ui";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

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

const NotificationsIcon = () => (
  <svg {...iconProps}>
    <path d="M8 2a2 2 0 0 1 2 2v.5c1.5.5 2.5 2 2.5 3.5H3.5C3.5 6.5 4.5 5 6 4.5V4a2 2 0 0 1 2-2z" />
    <path d="M5.5 12a2.5 2.5 0 0 0 5 0" />
  </svg>
);

const PortfolioIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="2" width="5" height="5" rx="0.5" />
    <rect x="9" y="2" width="5" height="5" rx="0.5" />
    <rect x="2" y="9" width="5" height="5" rx="0.5" />
    <rect x="9" y="9" width="5" height="5" rx="0.5" />
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
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);

  const isAccount =
    (pathname === "/account" || pathname.startsWith("/account/")) &&
    pathname !== "/account/billing";
  const isPersonalInbox = pathname === "/";
  const isBilling = pathname === "/account/billing";
  const triggerActive = pathname === "/account" || pathname.startsWith("/account/");

  const userName =
    user?.name || user?.email?.split("@")[0] || (authMode === "none" ? "Local" : "You");
  const userEmail = user?.name && user?.email ? user.email : null;

  const go = useCallback(
    (to: string) => {
      navigate(to);
      setOpen(false);
    },
    [navigate],
  );

  const signOut = useCallback(() => {
    logout();
    setOpen(false);
    navigate("/login");
  }, [logout, navigate]);

  const trigger = (
    <button
      type="button"
      className={`account-dropdown-trigger${triggerActive ? " account-dropdown-trigger--active" : ""}`}
      aria-label="Account menu"
      aria-current={triggerActive ? "page" : undefined}
    >
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
    </button>
  );

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} placement="top-start" portal>
      <div className="account-dropdown-menu" role="menu">
        {authMode !== "none" ? (
          <>
            <SelectOption
              selected={isAccount}
              onClick={() => go("/account")}
              leadingIcon={<AccountIcon />}
            >
              Account
            </SelectOption>
            <SelectOption
              selected={isPersonalInbox}
              onClick={() => go("/")}
              leadingIcon={<InboxIcon />}
            >
              Personal Inbox
            </SelectOption>
            <SelectOption
              disabled
              leadingIcon={<NotificationsIcon />}
              trailingHint="soon"
              title="Coming soon"
            >
              Notifications
            </SelectOption>
            <SelectOption
              disabled
              leadingIcon={<PortfolioIcon />}
              trailingHint="soon"
              title="Coming soon"
            >
              Portfolio
            </SelectOption>
            <SelectOption
              selected={isBilling}
              onClick={() => go("/account/billing")}
              leadingIcon={<BillingIcon />}
            >
              Billing
            </SelectOption>
            <SelectOption onClick={signOut} leadingIcon={<SignOutIcon />}>
              Log out
            </SelectOption>
          </>
        ) : (
          <div className="account-dropdown-item account-dropdown-item--label">Local mode</div>
        )}
      </div>
    </Popover>
  );
}
