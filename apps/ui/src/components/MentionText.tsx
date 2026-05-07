/**
 * MentionText — renders a body string with @-mention tokens as styled,
 * navigable spans.
 *
 * For each resolved mention the span carries:
 *   - CSS class `mention mention--<kind>`
 *   - onClick that navigates to the target's surface when a lookup hits
 *
 * Unresolved fuzzy mentions render with the same styling but no navigation
 * (cursor falls back to default).
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { splitBodyIntoSegments, type MentionToken } from "@/lib/mentions";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";

interface MentionTextProps {
  body: string;
  /** The entity scope — used to build canonical agent paths. */
  entityId?: string;
  className?: string;
}

export default function MentionText({ body, entityId, className }: MentionTextProps) {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);

  const handleClick = useCallback(
    (token: MentionToken) => {
      if (!entityId) return;
      if (token.kind === "agent") {
        navigate(entityPathFromId(entities, entityId, "agents", encodeURIComponent(token.id)));
      } else if (token.kind === "fuzzy") {
        // Try to resolve by name.
        const match = agents.find((a) => a.name?.toLowerCase() === token.id.toLowerCase());
        if (match) {
          navigate(entityPathFromId(entities, entityId, "agents", encodeURIComponent(match.id)));
        }
      }
      // user / position navigation not yet wired — no-op for now.
    },
    [navigate, entityId, entities, agents],
  );

  const segments = splitBodyIntoSegments(body);

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          seg.text
        ) : (
          <span
            key={i}
            className={`mention mention--${seg.token.kind}`}
            role="link"
            tabIndex={0}
            onClick={() => handleClick(seg.token)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleClick(seg.token);
            }}
          >
            {seg.token.rawText}
          </span>
        ),
      )}
    </span>
  );
}
