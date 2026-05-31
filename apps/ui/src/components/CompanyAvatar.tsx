import { useState } from "react";
import BrandMark from "./BrandMark";

export interface CompanyAvatarProps {
  /** Display name — used as the alt text when a custom image lands. */
  name: string;
  /** Optional custom image URL. When present, wins over the brandmark. */
  src?: string | null;
  /** Container size in px. Default 32. */
  size?: number;
  className?: string;
}

/**
 * CompanyAvatar — canonical render for a COMPANY's visual identity.
 *
 * When the COMPANY has a custom image (`src`), that fills the rounded-
 * square frame via `object-fit: cover`. Otherwise the AEQI brandmark
 * (æ ligature in Zen Dots, var(--color-accent)) sits centered on a
 * white card-elevated surface — the runtime's signature standing in
 * for an organization that hasn't customized yet.
 *
 * Mirrors UserAvatar / AgentAvatar as actor identity circles, while
 * Companies keep the institutional rounded-square frame: white-bg +
 * black brandmark by default.
 */
export default function CompanyAvatar({ name, src, size = 32, className }: CompanyAvatarProps) {
  const [imgErrored, setImgErrored] = useState(false);
  const showImage = src && !imgErrored;

  const radius = size <= 20 ? 4 : size <= 48 ? 6 : 10;

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: radius,
        background: showImage ? "transparent" : "var(--color-card-elevated)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={name}
          onError={() => setImgErrored(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <BrandMark size={Math.round(size * 0.6)} />
      )}
    </span>
  );
}
