import { type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  /** Body copy explaining the consequence of the action. */
  message: ReactNode;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Label for the cancel button. */
  cancelLabel?: string;
  /** Use the danger variant for destructive actions. */
  destructive?: boolean;
  /** Show a spinner on the confirm button (e.g. during an async call). */
  loading?: boolean;
}

/**
 * Modal-based replacement for window.confirm()/window.prompt() across
 * destructive actions in Settings (delete account, revoke session,
 * remove wallet, disable TOTP, etc.). One canonical confirmation
 * pattern that follows the brand register — replaces the unstyled
 * native browser dialog that ships in every browser since 1996.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className={styles.body}>{message}</div>
      <div className={styles.actions}>
        <Button variant="secondary" size="md" type="button" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          size="md"
          type="button"
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

ConfirmDialog.displayName = "ConfirmDialog";
