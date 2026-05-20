/**
 * `SolanaMark` — the three-bar Solana logo as inline SVG. lucide-react
 * doesn't ship a Solana glyph; embedding the path lets us tint via
 * `currentColor` and size via the `size` prop the same way every other
 * icon on the surface does. Use it whenever we want to signal "this
 * lives on Solana" — currently the trust hero's on-chain address chip.
 *
 * Path is the canonical Solana wordmark mark (3 angled bars), simplified
 * to a single color so the warm-palette ink doesn't fight the brand
 * gradient. We intentionally render it MONO, not gradient — the cockpit
 * is graphite-on-paper and a colored brand glyph would steal the moment.
 */
interface SolanaMarkProps {
  size?: number;
  className?: string;
}

export default function SolanaMark({ size = 14, className }: SolanaMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 397 311"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z" />
      <path d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z" />
      <path d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z" />
    </svg>
  );
}
