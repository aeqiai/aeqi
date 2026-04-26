import { useEffect, useState } from "react";

function useTokenValue(name: string | undefined): string {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!name) return;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    setValue(raw);
  }, [name]);
  return value;
}

type Role = {
  label: string;
  sample: string;
  fontVar: "--font-sans" | "--font-display" | "--font-brand";
  sizeVar?: string;
  weight?: number;
  note?: string;
  tracking?: string;
};

function Row({ role }: { role: Role }) {
  const font = useTokenValue(role.fontVar);
  const size = useTokenValue(role.sizeVar);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 24,
        padding: "20px 0",
        borderTop: "1px solid rgba(0,0,0,0.06)",
        alignItems: "baseline",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: "rgba(0,0,0,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {role.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10.5,
            color: "rgba(0,0,0,0.55)",
          }}
        >
          {role.fontVar}
          {role.sizeVar ? ` · ${role.sizeVar}` : ""}
          {role.weight ? ` · ${role.weight}` : ""}
        </span>
        {role.note ? (
          <span style={{ fontSize: 11, color: "rgba(0,0,0,0.4)", marginTop: 4 }}>{role.note}</span>
        ) : null}
      </div>
      <div
        style={{
          fontFamily: font || "inherit",
          fontSize: size || undefined,
          fontWeight: role.weight,
          color: "rgba(0,0,0,0.9)",
          letterSpacing: role.tracking,
          lineHeight: 1.2,
        }}
      >
        {role.sample}
      </div>
    </div>
  );
}

export function TypeSpecimen({ roles }: { roles: Role[] }) {
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 12,
        padding: "4px 24px",
        background: "#ffffff",
        margin: "20px 0",
      }}
    >
      {roles.map((r) => (
        <Row key={r.label} role={r} />
      ))}
    </div>
  );
}
