import { useEffect, useState } from "react";

const TOKENS = [
  { name: "--space-1", usage: "Tight gaps" },
  { name: "--space-2", usage: "Inline spacing" },
  { name: "--space-3", usage: "Compact padding" },
  { name: "--space-4", usage: "Standard padding" },
  { name: "--space-6", usage: "Panel padding" },
  { name: "--space-8", usage: "Page-level spacing" },
];

function useTokenValue(name: string): string {
  const [value, setValue] = useState("");
  useEffect(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    setValue(raw);
  }, [name]);
  return value;
}

function Bar({ token, usage }: { token: string; usage: string }) {
  const value = useTokenValue(token);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr 180px",
        alignItems: "center",
        gap: 16,
        padding: "8px 0",
      }}
    >
      <code style={{ fontSize: 12, color: "rgba(0,0,0,0.85)" }}>{token}</code>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "inline-block",
            height: 10,
            width: value || 0,
            background: "#0a0a0b",
            borderRadius: 2,
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            color: "rgba(0,0,0,0.45)",
          }}
        >
          {value || "—"}
        </span>
      </div>
      <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>{usage}</span>
    </div>
  );
}

export function SpacingScale() {
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 12,
        padding: "16px 24px",
        background: "#ffffff",
        margin: "20px 0",
      }}
    >
      {TOKENS.map((t) => (
        <Bar key={t.name} token={t.name} usage={t.usage} />
      ))}
    </div>
  );
}
