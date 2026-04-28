import { useState } from "react";

const TRACKS = [
  { token: "--transition-fast", label: "Fast", usage: "Hover, focus, state toggle" },
  { token: "--transition-normal", label: "Normal", usage: "Entrances, layout shifts" },
  { token: "--transition-slow", label: "Slow", usage: "Page-level reveal, hero" },
];

export function MotionDemo() {
  const [key, setKey] = useState(0);

  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 12,
        padding: 24,
        background: "#ffffff",
        margin: "20px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setKey((k) => k + 1)}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: "1px solid rgba(0,0,0,0.06)",
            background: "#0a0a0b",
            color: "#ffffff",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Play
        </button>
        <span style={{ fontSize: 12, color: "rgba(0,0,0,0.5)" }}>
          Click to slide all three tracks. Compare cadence.
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {TRACKS.map((t) => (
          <div
            key={t.token}
            style={{
              display: "grid",
              gridTemplateColumns: "160px 1fr 220px",
              alignItems: "center",
              gap: 16,
            }}
          >
            <code style={{ fontSize: 12, color: "rgba(0,0,0,0.85)" }}>{t.token}</code>
            <div
              style={{
                position: "relative",
                height: 24,
                background: "#f3f3f4",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <span
                key={key}
                style={{
                  position: "absolute",
                  top: 6,
                  left: 6,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#0a0a0b",
                  animation: `motion-demo-slide var(${t.token}) forwards`,
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>{t.usage}</span>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes motion-demo-slide {
          from { transform: translateX(0); }
          to   { transform: translateX(calc(100% + 100px)); }
        }
      `}</style>
    </div>
  );
}
