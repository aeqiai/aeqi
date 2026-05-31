import RoundAvatar from "./RoundAvatar";

/**
 * UserAvatar — canonical render for humans.
 *
 * Round, colorful (hash-driven hue, initials fallback). Mirrors the
 * canonical identity rule:
 *   round          → human or agent actor
 *   rounded-square → COMPANY / institutional entity
 * Component code uses these wrappers, not the primitives directly.
 */
export default function UserAvatar({
  name,
  size = 22,
  src,
}: {
  name: string;
  size?: number;
  src?: string | null;
}) {
  return <RoundAvatar name={name} size={size} src={src} />;
}
