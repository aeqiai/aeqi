import { useEffect, useState } from "react";

type Swatch = {
  token: string;
  label?: string;
  note?: string;
};

function useTokenValue(name: string): string {
  const [value, setValue] = useState("");
  useEffect(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    setValue(raw);
  }, [name]);
  return value;
}

function SwatchCard({ swatch, variant }: { swatch: Swatch; variant: "chroma" | "ink" }) {
  const value = useTokenValue(swatch.token);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(swatch.token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  }

  const chipBg = variant === "ink" ? "#ffffff" : `var(${swatch.token})`;
  const chipBorder = variant === "ink" ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.06)";
  const chipOverlay =
    variant === "ink" ? (
      <span
        style={{
          position: "absolute",
          inset: 12,
          borderRadius: 8,
          background: `var(${swatch.token})`,
        }}
      />
    ) : null;

  return (
    <button
      type="button"
      onClick={copy}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
        background: "#ffffff",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 10,
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
      }}
      aria-label={`Copy ${swatch.token}`}
    >
      <span
        style={{
          position: "relative",
          height: 72,
          borderRadius: 8,
          background: chipBg,
          border: `1px solid ${chipBorder}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
          overflow: "hidden",
        }}
      >
        {chipOverlay}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            color: "rgba(0,0,0,0.85)",
            wordBreak: "break-all",
          }}
        >
          {swatch.token}
        </span>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10.5,
            color: "rgba(0,0,0,0.45)",
            wordBreak: "break-all",
          }}
        >
          {value || "—"}
        </span>
        {swatch.label ? (
          <span
            style={{
              fontSize: 11.5,
              color: "rgba(0,0,0,0.62)",
              marginTop: 4,
            }}
          >
            {swatch.label}
          </span>
        ) : null}
        {swatch.note ? (
          <span
            style={{
              fontSize: 10.5,
              color: "rgba(0,0,0,0.38)",
            }}
          >
            {swatch.note}
          </span>
        ) : null}
      </span>
      <span
        style={{
          marginTop: "auto",
          fontSize: 10.5,
          color: copied ? "#2e8f71" : "rgba(0,0,0,0.35)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {copied ? "copied" : "click to copy"}
      </span>
    </button>
  );
}

export function ColorSwatchGrid({
  swatches,
  variant = "chroma",
  columns = 4,
}: {
  swatches: Swatch[];
  variant?: "chroma" | "ink";
  columns?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 12,
        margin: "20px 0",
      }}
    >
      {swatches.map((s) => (
        <SwatchCard key={s.token} swatch={s} variant={variant} />
      ))}
    </div>
  );
}
