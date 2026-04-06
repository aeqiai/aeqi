// Deterministic blocky avatar — 5x5 mirrored grid, greytones
export default function BlockAvatar({ name, size = 22 }: { name: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;

  const cells: boolean[] = [];
  let h = Math.abs(hash);
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
        rects.push(<rect key={`${row}-${col}`} x={col * cellSize} y={row * cellSize} width={cellSize} height={cellSize} fill={fg} />);
        if (col < 2) {
          rects.push(<rect key={`${row}-${4 - col}`} x={(4 - col) * cellSize} y={row * cellSize} width={cellSize} height={cellSize} fill={fg} />);
        }
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 4, flexShrink: 0, background: bg, display: "block" }}>
      {rects}
    </svg>
  );
}
