/**
 * BrandMark — the æ ligature, used wherever the full wordmark won't fit
 * (favicons, app icons, agent surfaces, dense lists). The "i" is dropped;
 * what remains is the runtime's identity in a single glyph.
 *
 * Canonical brand spec (see aeqi-landing /brand):
 *   Typeface  Inter
 *   Weight    700
 *   Tracking  -0.05em
 *   Color     rgba(0, 0, 0, 0.5)
 *
 * Default color is the canonical 50% black so dropping <BrandMark /> into
 * any surface yields the brand-correct shade without callers having to
 * remember it. Pass `color="currentColor"` to inherit from the parent.
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
        fontFamily: "var(--font-sans)",
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.05em",
        color,
        lineHeight: 1,
        display: "inline-block",
      }}
    >
      æ
    </span>
  );
}
