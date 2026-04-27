import type { QuestPriority } from "@/lib/types";

/**
 * Priority indicator — three ascending bars (Linear / Notion idiom).
 * Fill count maps to the priority level: low=1 / normal=2 / high=3 /
 * critical=3 with a destructive accent so it pops past the rest.
 * Empty bars stroke at 35% so the unfilled state still registers as
 * "this is a priority indicator", not absent UI.
 *
 * Color codes via the wrapping `.quest-prio-icon--<level>` class:
 * critical → `--error`, high → `--text-title`, normal →
 * `--text-secondary`, low → `--text-muted`. The `<rect>` strokes
 * inherit `currentColor`, so each level paints automatically.
 *
 * Canonical: import from this module everywhere. Both the row chrome
 * (list view + board card) and the priority popover trigger/rows use
 * the same component so the affordance reads identically across the
 * surface.
 */
export default function PriorityIcon({ priority }: { priority: QuestPriority }) {
  const filled = priority === "critical" || priority === "high" ? 3 : priority === "normal" ? 2 : 1;
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className={`quest-prio-icon quest-prio-icon--${priority}`}
      aria-hidden
    >
      {[0, 1, 2].map((i) => {
        const h = 3 + i * 2; // 3, 5, 7
        const y = 10 - h;
        const isFilled = i < filled;
        return (
          <rect
            key={i}
            x={1 + i * 4}
            y={y}
            width={2}
            height={h}
            rx={0.5}
            fill={isFilled ? "currentColor" : "transparent"}
            stroke="currentColor"
            strokeWidth={1}
            opacity={isFilled ? 1 : 0.35}
          />
        );
      })}
    </svg>
  );
}
