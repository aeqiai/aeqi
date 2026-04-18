/**
 * Wordmark — the full æqi wordmark with the shifted "i".
 *
 * Canonical brand spec (see aeqi-landing /brand):
 *   Typeface  Inter
 *   Weight    700
 *   Tracking  -0.05em
 *   i offset  translateY(0.05em)
 *   Color     rgba(0, 0, 0, 0.5)
 *
 * Default color is `currentColor` so the mark inherits from its parent,
 * letting callers drive hover/focus transitions with regular CSS.
 * Pass `color` explicitly (e.g. auth pages) to pin the shade.
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
        fontFamily: "var(--font-sans)",
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.05em",
        color,
        lineHeight: 1,
      }}
    >
      æq<span style={{ display: "inline-block", transform: "translateY(0.05em)" }}>i</span>
    </span>
  );
}
