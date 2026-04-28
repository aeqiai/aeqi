import { forwardRef } from "react";
import styles from "./ChipClose.module.css";

export interface ChipCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label — required; must clearly identify what is being removed. */
  label: string;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

export const ChipClose = forwardRef<HTMLButtonElement, ChipCloseProps>(function ChipClose(
  { label, className, type = "button", ...rest },
  ref,
) {
  const cls = [styles.chipClose, className].filter(Boolean).join(" ");

  return (
    <button ref={ref} type={type} className={cls} aria-label={label} {...rest}>
      <CloseIcon />
    </button>
  );
});

ChipClose.displayName = "ChipClose";
