import { useEffect, useState } from "react";

const TOKENS = [
  { name: "--radius-xs", usage: "Key pills, tight chips" },
  { name: "--radius-sm", usage: "Badges, tags" },
  { name: "--radius-md", usage: "Inputs, buttons" },
  { name: "--radius-lg", usage: "Panels, cards" },
  { name: "--radius-xl", usage: "Modals" },
  { name: "--radius-full", usage: "Pills, avatars" },
];

function useTokenValue(name: string): string {
  const [value, setValue] = useState("");
  useEffect(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    setValue(raw);
  }, [name]);
  return value;
}

function Chip({ token, usage }: { token: string; usage: string }) {
  const value = useTokenValue(token);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          background: "#0a0a0b",
          borderRadius: `var(${token})`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <code style={{ fontSize: 12, color: "rgba(0,0,0,0.85)" }}>{token}</code>
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 11,
            color: "rgba(0,0,0,0.45)",
          }}
        >
          {value || "—"}
        </span>
        <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", marginTop: 2 }}>{usage}</span>
      </div>
    </div>
  );
}

export function RadiusScale() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 20,
        padding: 24,
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 12,
        background: "#ffffff",
        margin: "20px 0",
      }}
    >
      {TOKENS.map((t) => (
        <Chip key={t.name} token={t.name} usage={t.usage} />
      ))}
    </div>
  );
}
