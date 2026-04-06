/**
 * Deterministic SVG avatar generated from a username hash.
 * Produces a 5x5 symmetric identicon (like GitHub's) inside a 28x28 circle.
 */

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const PALETTE = [
  "#60a5fa", // blue
  "#4ade80", // green
  "#f472b6", // pink
  "#a78bfa", // purple
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#facc15", // yellow
  "#e879f9", // fuchsia
  "#38bdf8", // sky
  "#34d399", // emerald
];

export default function UserAvatar({
  name,
  size = 28,
}: {
  name: string;
  size?: number;
}) {
  const h = hashName(name);
  const fg = PALETTE[h % PALETTE.length];
  const bgHue = (h * 37) % 360;
  const clipId = `avatar-clip-${h}`;

  // 5x5 grid, mirrored horizontally (only compute 3 columns)
  const cells: boolean[][] = [];
  let bits = h;
  for (let row = 0; row < 5; row++) {
    cells[row] = [];
    for (let col = 0; col < 3; col++) {
      cells[row][col] = (bits & 1) === 1;
      bits = bits >>> 1;
      if (bits === 0) bits = hashName(name + row + col) || 1;
    }
    // Mirror: col 3 = col 1, col 4 = col 0
    cells[row][3] = cells[row][1];
    cells[row][4] = cells[row][0];
  }

  const cellSize = size / 7; // 7 units: 1 padding + 5 cells + 1 padding
  const pad = cellSize;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="user-avatar-svg"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={size / 2} cy={size / 2} r={size / 2} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2}
          fill={`hsl(${bgHue}, 15%, 14%)`}
        />
        {cells.map((row, ri) =>
          row.map((on, ci) =>
            on ? (
              <rect
                key={`${ri}-${ci}`}
                x={pad + ci * cellSize}
                y={pad + ri * cellSize}
                width={cellSize}
                height={cellSize}
                rx={cellSize * 0.2}
                fill={fg}
                opacity={0.9}
              />
            ) : null,
          ),
        )}
      </g>
    </svg>
  );
}
