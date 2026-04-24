export function ElevationDemo() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 24,
        padding: 32,
        background: "#f4f4f5",
        borderRadius: 12,
        margin: "20px 0",
      }}
    >
      <figure style={{ margin: 0 }}>
        <div
          style={{
            height: 120,
            borderRadius: 12,
            background: "#ffffff",
            boxShadow: "var(--card-elevation)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            color: "rgba(0,0,0,0.62)",
          }}
        >
          --card-elevation
        </div>
        <figcaption
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "rgba(0,0,0,0.55)",
          }}
        >
          Canonical lifted card. Use for content sheets, modals, popovers.
        </figcaption>
      </figure>

      <figure style={{ margin: 0 }}>
        <div
          style={{
            height: 120,
            borderRadius: 12,
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            color: "rgba(0,0,0,0.62)",
          }}
        >
          hairline only
        </div>
        <figcaption
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "rgba(0,0,0,0.55)",
          }}
        >
          Flat surface. Default for inline panels and in-document cards.
        </figcaption>
      </figure>

      <figure style={{ margin: 0 }}>
        <div
          style={{
            height: 120,
            borderRadius: 12,
            background: "#ffffff",
            boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            color: "rgba(0,0,0,0.62)",
          }}
        >
          heavy drop shadow
        </div>
        <figcaption
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "rgba(184, 92, 92, 0.85)",
          }}
        >
          Don&apos;t. Reads as generic SaaS. Not part of the system.
        </figcaption>
      </figure>
    </div>
  );
}
