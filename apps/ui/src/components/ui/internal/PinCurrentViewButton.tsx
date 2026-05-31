import { type FormEvent, useMemo, useState } from "react";
import { Pin } from "lucide-react";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { IconButton } from "../IconButton";
import { Input } from "../Input";
import { Modal } from "../Modal";
import { Tooltip } from "../Tooltip";
import { useUIStore } from "@/store/ui";
import styles from "./PinCurrentViewButton.module.css";

interface CurrentRoute {
  label: string;
  path: string;
  search: string;
  companyId?: string;
}

interface PinCurrentViewButtonProps {
  defaultLabel?: string;
}

function getBrowserRoute(): Pick<CurrentRoute, "path" | "search"> {
  if (typeof window === "undefined") {
    return { path: "/", search: "" };
  }

  return {
    path: window.location.pathname || "/",
    search: window.location.search || "",
  };
}

function companyIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/company\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function labelFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment || lastSegment === "company") return "View";

  try {
    return titleCase(decodeURIComponent(lastSegment).replace(/[-_]+/g, " "));
  } catch {
    return titleCase(lastSegment.replace(/[-_]+/g, " "));
  }
}

function buildCurrentRoute(defaultLabel?: string, activeEntity?: string): CurrentRoute {
  const { path, search } = getBrowserRoute();
  const routeCompanyId =
    companyIdFromPath(path) ?? (path === "/company" ? activeEntity : undefined);

  return {
    label: defaultLabel?.trim() || labelFromPath(path),
    path,
    search,
    companyId: routeCompanyId || undefined,
  };
}

export default function PinCurrentViewButton({ defaultLabel }: PinCurrentViewButtonProps) {
  const activeEntity = useUIStore((s) => s.activeEntity);
  const pinnedViews = useUIStore((s) => s.pinnedViews);
  const savePinnedView = useUIStore((s) => s.savePinnedView);
  const [draftRoute, setDraftRoute] = useState<CurrentRoute | null>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState("");
  const currentRoute = buildCurrentRoute(defaultLabel, activeEntity);
  const existingPinnedView = useMemo(
    () =>
      pinnedViews.find(
        (view) => view.path === currentRoute.path && view.search === currentRoute.search,
      ),
    [currentRoute.path, currentRoute.search, pinnedViews],
  );
  const isPinned = Boolean(existingPinnedView);

  const openModal = () => {
    const route = buildCurrentRoute(existingPinnedView?.label ?? defaultLabel, activeEntity);
    setDraftRoute(route);
    setDraftName(existingPinnedView?.label ?? route.label);
    setError("");
  };

  const closeModal = () => {
    setDraftRoute(null);
    setError("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftRoute) return;

    const label = draftName.trim();
    if (!label) {
      setError("Name is required.");
      return;
    }

    savePinnedView({
      label,
      path: draftRoute.path,
      search: draftRoute.search,
      companyId: draftRoute.companyId,
    });
    closeModal();
  };

  return (
    <>
      <Tooltip content={isPinned ? "Edit pinned view" : "Pin current view"}>
        <IconButton
          type="button"
          aria-label={isPinned ? "Edit pinned view" : "Pin current view"}
          aria-pressed={isPinned}
          className={styles.pinButton}
          variant="bordered"
          size="md"
          onClick={openModal}
        >
          <Icon icon={Pin} size="sm" />
        </IconButton>
      </Tooltip>
      <Modal
        open={Boolean(draftRoute)}
        onClose={closeModal}
        title={isPinned ? "Edit pinned view" : "Pin current view"}
        description="Save this exact route in Views so you can return to it quickly."
        footer={
          <div className={styles.footer}>
            <Button type="button" variant="secondary" size="sm" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" form="pin-current-view-form" variant="primary" size="sm">
              Save view
            </Button>
          </div>
        }
      >
        <form id="pin-current-view-form" className={styles.form} onSubmit={handleSubmit}>
          <Input
            label="Name"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.currentTarget.value);
              if (error) setError("");
            }}
            error={error}
            required
          />
          {draftRoute && (
            <div className={styles.route}>
              <span className={styles.routeLabel}>Route</span>
              <span className={styles.routeValue}>{`${draftRoute.path}${draftRoute.search}`}</span>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
