import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Popover, SelectOption } from "@/components/ui";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";
import { Events, useTrack } from "@/lib/analytics";

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
  const track = useTrack();
  const [open, setOpen] = useState(false);

  const isAccount =
    (pathname === "/account" || pathname.startsWith("/account/")) &&
    pathname !== "/account/billing";
  const isBilling = pathname === "/account/billing";
  // Row-level "active" — highlighted whenever we're somewhere under /account.
  const rowActive = pathname === "/account" || pathname.startsWith("/account/");

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
    track(Events.AuthLogout, { surface: "account-dropdown" });
    logout();
    setOpen(false);
    navigate("/login");
  }, [track, logout, navigate]);

  // Local-mode (no auth) keeps the bare identity tile — no popover, no
  // navigation; there's no /account route to land on and no actions to surface.
  if (authMode === "none") {
    return (
      <div className="account-dropdown-row">
        <div
          className="account-dropdown-trigger account-dropdown-trigger--static"
          aria-label="Local mode"
        >
          <span className="account-dropdown-avatar">
            <UserAvatar name={userName} size={16} src={user?.avatar_url} />
          </span>
          <span className="account-dropdown-identity">
            <span className="account-dropdown-name">Local mode</span>
          </span>
        </div>
      </div>
    );
  }

  // The row IS the trigger. Click anywhere on the row opens the popover.
  // The "Account" item inside the dropdown navigates to /account — the
  // row itself does not navigate. Single affordance, no chevron.
  const rowTrigger = (
    <button
      type="button"
      className={`account-dropdown-trigger${rowActive ? " account-dropdown-trigger--active" : ""}`}
      aria-label="Account menu"
      aria-haspopup="menu"
      aria-current={rowActive ? "page" : undefined}
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
    <div className="account-dropdown-row">
      <Popover trigger={rowTrigger} open={open} onOpenChange={setOpen} placement="top-start" portal>
        <div className="account-dropdown-menu" role="menu">
          <SelectOption
            selected={isAccount}
            onClick={() => go("/account")}
            leadingIcon={<AccountIcon />}
          >
            Account
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
            selected={isBilling}
            onClick={() => go("/account/billing")}
            leadingIcon={<BillingIcon />}
          >
            Billing
          </SelectOption>
          <SelectOption onClick={signOut} leadingIcon={<SignOutIcon />}>
            Log out
          </SelectOption>
        </div>
      </Popover>
    </div>
  );
}
