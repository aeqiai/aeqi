import styles from "./ClipboardToast.module.css";

export interface ClipboardToastProps {
  label: string | null;
}

export function ClipboardToast({ label }: ClipboardToastProps) {
  if (!label) return null;

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      {label}
    </div>
  );
}

ClipboardToast.displayName = "ClipboardToast";
