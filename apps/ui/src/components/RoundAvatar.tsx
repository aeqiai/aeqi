import { useState } from "react";

// Round avatar for users and agents — image when available, initials fallback.
export default function RoundAvatar({
  name,
  size = 22,
  src,
}: {
  name: string;
  size?: number;
  src?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (src && !imageFailed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setImageFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          flexShrink: 0,
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;

  const hue = Math.abs(hash) % 360;
  const bg = `hsl(${hue}, 35%, 78%)`;
  const fg = `hsl(${hue}, 40%, 30%)`;

  const initials = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");

  const fontSize = size * 0.42;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize,
        fontWeight: 600,
        color: fg,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        userSelect: "none",
      }}
    >
      {initials || "?"}
    </div>
  );
}
