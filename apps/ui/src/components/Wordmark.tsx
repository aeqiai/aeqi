/**
 * Wordmark — the full aeqi wordmark.
 *
 * Canonical brand spec:
 *   Typeface  Zen Dots (var(--font-brand)) — reserved for the wordmark only.
 *   Weight    400 (Zen Dots ships a single weight)
 *   Glyphs    "aeqi" — four separate letters. The æ ligature was dropped
 *             2026-05-20: brand reads as a-e-q-i, not the connected æ.
 *   Color     var(--color-accent) by default so the brand stays consistent
 *             on any surface. Pass `color="currentColor"` to inherit, or
 *             any explicit value to pin the shade.
 */
export default function Wordmark({
  size = 18,
  className = "",
  color = "var(--color-accent)",
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
      aeqi
    </span>
  );
}
