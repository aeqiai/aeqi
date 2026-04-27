import { useRef, useState, type DragEvent } from "react";
import UserAvatar from "@/components/UserAvatar";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export type Feedback = { type: "success" | "error"; msg: string } | null;

interface AvatarUploaderProps {
  name: string;
  src: string | null | undefined;
  /** Mirrors local user-state in ProfilePanel so the form stays in sync. */
  onSrcChange: (next: string | null) => void;
  onFeedback: (fb: Feedback) => void;
}

export default function AvatarUploader({
  name,
  src,
  onSrcChange,
  onFeedback,
}: AvatarUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fetchMe = useAuthStore((s) => s.fetchMe);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      onFeedback({ type: "error", msg: "That's not an image." });
      return;
    }
    if (file.size > MAX_BYTES) {
      onFeedback({ type: "error", msg: "Image must be under 2 MB." });
      return;
    }
    setBusy(true);
    onFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Couldn't read the image."));
        reader.readAsDataURL(file);
      });
      // Optimistic preview before the round-trip lands.
      onSrcChange(dataUrl);
      await api.updateAvatar(dataUrl);
      // Refresh the auth-store user so sidebar + top-bar pick the new image up.
      await fetchMe();
      onFeedback({ type: "success", msg: "Avatar updated." });
      setTimeout(() => onFeedback(null), 2500);
    } catch (err: unknown) {
      onFeedback({ type: "error", msg: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    onFeedback(null);
    try {
      onSrcChange(null);
      await api.updateAvatar("");
      await fetchMe();
      onFeedback({ type: "success", msg: "Photo removed." });
      setTimeout(() => onFeedback(null), 2500);
    } catch (err: unknown) {
      onFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Couldn't remove photo.",
      });
    } finally {
      setBusy(false);
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void upload(f);
  };

  return (
    <div className="avatar-uploader">
      <button
        type="button"
        className={`avatar-uploader-zone${dragOver ? " is-drag" : ""}${busy ? " is-busy" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        aria-label={src ? "Change photo" : "Upload photo"}
        disabled={busy}
      >
        <UserAvatar name={name} size={64} src={src} />
        <span className="avatar-uploader-overlay" aria-hidden>
          {busy ? (
            <Spinner size="sm" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="13" r="3.5" strokeWidth="1.5" />
            </svg>
          )}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="account-hidden-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
        />
      </button>
      <div className="avatar-uploader-meta">
        <div className="avatar-uploader-actions">
          <button
            type="button"
            className="avatar-uploader-link"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {src ? "Change photo" : "Upload photo"}
          </button>
          {src && (
            <>
              <span className="avatar-uploader-sep" aria-hidden>
                ·
              </span>
              <button
                type="button"
                className="avatar-uploader-link avatar-uploader-link--danger"
                onClick={remove}
                disabled={busy}
              >
                Remove
              </button>
            </>
          )}
        </div>
        <div className="avatar-uploader-hint">Click or drop · max 2 MB · png, jpg, webp, gif</div>
      </div>
    </div>
  );
}
