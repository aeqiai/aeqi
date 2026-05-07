import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tooltip } from "@/components/ui";

/**
 * Shared surface-header primitive used by drilled-into-a-primitive
 * landing surfaces (agent default, event detail, future: idea detail,
 * quest detail). Establishes a single shape:
 *
 *   [← <BackLabel>]  ·  <title>  [crumbSuffix]   ·   <actions>
 *
 * Back link on the left; the title slot can be plain text or a richer
 * composition (avatar + name); optional `crumbSuffix` extends the
 * breadcrumb (e.g. "/ Settings"); actions render right-aligned.
 *
 * Adopters keep the canonical `.agent-surface-header*` class names —
 * those rules are surface-agnostic and act as the design-system tokens
 * for this header pattern.
 */
export default function SurfaceHeader({
  backHref,
  backLabel,
  title,
  crumbSuffix,
  actions,
}: {
  backHref: string;
  backLabel: string;
  title: ReactNode;
  crumbSuffix?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="agent-surface-header">
      <div className="agent-surface-header-crumbs">
        <Tooltip content={`Back to ${backLabel}`}>
          <Link to={backHref} className="agent-surface-header-back">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10 12L6 8l4-4" />
            </svg>
            {backLabel}
          </Link>
        </Tooltip>
        <span className="agent-surface-header-sep" aria-hidden>
          /
        </span>
        {title}
        {crumbSuffix}
      </div>
      {actions && <div className="agent-surface-header-actions">{actions}</div>}
    </div>
  );
}
