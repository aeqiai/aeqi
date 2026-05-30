import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { User, CreditCard, LogOut, Shield } from "lucide-react";
import { Icon, Popover, SelectOption } from "@/components/ui";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";
import { Events, useTrack } from "@/lib/analytics";

const AccountIcon = () => <Icon icon={User} size="sm" />;
const BillingIcon = () => <Icon icon={CreditCard} size="sm" />;
const AdminIcon = () => <Icon icon={Shield} size="sm" />;
const SignOutIcon = () => <Icon icon={LogOut} size="sm" />;

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
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminUser = user?.is_admin === true;
  // Row-level "active" — highlighted whenever we're somewhere under /account
  // or /admin (admin tools live under the account menu now).
  const rowActive = pathname === "/account" || pathname.startsWith("/account/") || isAdminPath;

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
            selected={isBilling}
            onClick={() => go("/account/billing")}
            leadingIcon={<BillingIcon />}
          >
            Billing
          </SelectOption>
          {isAdminUser && (
            <SelectOption
              selected={isAdminPath}
              onClick={() => go("/admin")}
              leadingIcon={<AdminIcon />}
            >
              Admin
            </SelectOption>
          )}
          <SelectOption onClick={signOut} leadingIcon={<SignOutIcon />}>
            Log out
          </SelectOption>
        </div>
      </Popover>
    </div>
  );
}
