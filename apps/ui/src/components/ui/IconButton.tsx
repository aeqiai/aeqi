import { forwardRef } from "react";
import styles from "./IconButton.module.css";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "bordered" | "danger";
  size?: "xs" | "sm" | "md";
  /** Accessible label — required; icon-only buttons must expose a name. */
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "sm", className, children, type = "button", ...rest },
  ref,
) {
  const cls = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");

  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {children}
    </button>
  );
});

IconButton.displayName = "IconButton";
