// Deterministic blocky avatar — 5x5 mirrored grid, greytones.
//
// When an `href` prop is passed, the SVG is wrapped in a React Router
// <Link> so clicking the avatar navigates to the target identity (agent
// detail, role detail, user profile, etc.). Without `href` the SVG
// renders as a presentational element. Wrapping is opt-in so existing
// callers (org chart node icons, sidebar identicons, etc.) keep their
// presentational shape.
import { Link } from "react-router-dom";

export interface BlockAvatarProps {
  name: string;
  size?: number;
  /** When set, wraps the avatar in a React Router Link to this path. */
  href?: string;
  /** Optional aria-label override for the link wrapper. */
  ariaLabel?: string;
  /**
   * Shape of the avatar tile. Agents (and agent-adjacent identities like
   * positions, external) render as a slightly-rounded square; humans/users
   * render as a full circle. Default is `"rounded-square"` because most
   * existing call sites (org chart node icons, sidebar identicons) represent
   * agents. Pass `"circle"` explicitly when mounting for a human identity.
   */
  shape?: "circle" | "rounded-square";
}

export default function BlockAvatar({
  name,
  size = 22,
  href,
  ariaLabel,
  shape = "rounded-square",
}: BlockAvatarProps) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;

  const cells: boolean[] = [];
  const h = Math.abs(hash);
  for (let i = 0; i < 15; i++) {
    cells.push((h >> i) & 1 ? true : false);
  }

  const grey = 160 + (Math.abs(hash >> 8) % 60);
  const bg = `rgb(${grey},${grey},${grey})`;
  const fg = `rgb(${grey - 90},${grey - 90},${grey - 90})`;

  const cellSize = size / 5;
  const rects: React.ReactNode[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (cells[row * 3 + col]) {
        rects.push(
          <rect
            key={`${row}-${col}`}
            x={col * cellSize}
            y={row * cellSize}
            width={cellSize}
            height={cellSize}
            fill={fg}
          />,
        );
        if (col < 2) {
          rects.push(
            <rect
              key={`${row}-${4 - col}`}
              x={(4 - col) * cellSize}
              y={row * cellSize}
              width={cellSize}
              height={cellSize}
              fill={fg}
            />,
          );
        }
      }
    }
  }

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        borderRadius: shape === "circle" ? "50%" : "var(--radius-sm)",
        flexShrink: 0,
        background: bg,
        display: "block",
      }}
    >
      {rects}
    </svg>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="block-avatar-link"
        aria-label={ariaLabel ?? name}
        title={name}
        onClick={(e) => e.stopPropagation()}
      >
        {svg}
      </Link>
    );
  }

  return svg;
}
