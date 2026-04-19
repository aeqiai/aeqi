/**
 * Wordmark — the full æqi wordmark.
 *
 * Canonical brand spec:
 *   Typeface  Zen Dots (var(--font-brand)) — reserved for the wordmark only.
 *   Weight    400 (Zen Dots ships a single weight)
 *   Color     currentColor by default — pass `color` to pin the shade.
 *
 * Zen Dots has an engineered, block-like silhouette, so the Inter-era
 * negative tracking and translated "i" are dropped; the geometry of the
 * typeface is the identity.
 */
export default function Wordmark({
  size = 18,
  className = "",
  color = "currentColor",
}: {
  size?: number;
  className?: string;
  color?: string;
}) {
  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-brand)",
        fontSize: size,
        fontWeight: 400,
        letterSpacing: "-0.02em",
        color,
        lineHeight: 1,
      }}
    >
      æqi
    </span>
  );
}
