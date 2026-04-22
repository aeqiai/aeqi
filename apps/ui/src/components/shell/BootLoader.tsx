/**
 * Full-screen pulse splash shown while the daemon store makes its first
 * fetch. Intentionally minimal — no theme dependency, no layout, no fonts
 * beyond what the root CSS provides.
 */
export default function BootLoader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg-elevated, #f4f4f5)",
      }}
    >
      <span
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: "rgba(0,0,0,0.15)",
          animation: "ae-pulse 1.6s ease-in-out infinite",
        }}
      >
        æ
      </span>
      <style>{`@keyframes ae-pulse { 0%, 100% { opacity: 0.15; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.05); } }`}</style>
    </div>
  );
}
