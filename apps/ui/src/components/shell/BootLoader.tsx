import Wordmark from "@/components/Wordmark";

/**
 * Full-screen splash shown while the daemon store completes its first
 * fetch. Renders the canonical æqi wordmark with a gentle pulse so the
 * surface reads as deliberate rather than washed out.
 */
export default function BootLoader() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        minHeight: "100vh",
        background: "var(--color-bg-base, #ffffff)",
      }}
    >
      <span
        style={{
          animation: "ae-pulse 1.6s ease-in-out infinite",
          display: "inline-flex",
        }}
      >
        <Wordmark size={48} />
      </span>
      <style>{`
        @keyframes ae-pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
