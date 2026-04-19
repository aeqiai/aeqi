/**
 * BrandMark — the æ ligature, used wherever the full wordmark won't fit
 * (favicons, app icons, agent surfaces, dense lists). The "i" is dropped;
 * what remains is the runtime's identity in a single glyph.
 *
 * Canonical brand spec:
 *   Typeface  Zen Dots (var(--font-brand)) — reserved for the wordmark only.
 *   Weight    400 (Zen Dots ships a single weight)
 *   Color     rgba(0, 0, 0, 0.5) by default so dropping <BrandMark /> into
 *             any surface yields the brand-correct shade without callers
 *             having to remember it. Pass `color="currentColor"` to inherit.
 */
export default function BrandMark({
  size = 18,
  className = "",
  color = "rgba(0, 0, 0, 0.5)",
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
        display: "inline-block",
      }}
    >
      æ
    </span>
  );
}
