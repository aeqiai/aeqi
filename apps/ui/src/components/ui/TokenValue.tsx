import { useEffect, useState } from "react";

/**
 * Reads the live value of a CSS custom property from :root and displays it.
 * Used by the design-language docs so every value on the page tracks the
 * token file: change `--color-accent` in `tokens.css` and every label on
 * the design-language page updates on next paint. No hardcoded hex.
 */
export function TokenValue({ name, fallback = "" }: { name: string; fallback?: string }) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    setValue(raw || fallback);
  }, [name, fallback]);
  return <>{value}</>;
}
