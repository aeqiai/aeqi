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
  trustId?: string;
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

function trustIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/trust\/([^/]+)/);
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
  if (!lastSegment || lastSegment === "trust") return "View";

  try {
    return titleCase(decodeURIComponent(lastSegment).replace(/[-_]+/g, " "));
  } catch {
    return titleCase(lastSegment.replace(/[-_]+/g, " "));
  }
}

function buildCurrentRoute(defaultLabel?: string, activeEntity?: string): CurrentRoute {
  const { path, search } = getBrowserRoute();
  const routeTrustId = trustIdFromPath(path) ?? (path === "/trust" ? activeEntity : undefined);

  return {
    label: defaultLabel?.trim() || labelFromPath(path),
    path,
    search,
    trustId: routeTrustId || undefined,
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
      trustId: draftRoute.trustId,
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
        title={isPinned ? "Edit pinned view" : "Pin view"}
      >
        <form className={styles.form} onSubmit={handleSubmit}>
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
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
