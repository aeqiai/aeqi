import { forwardRef } from "react";
import styles from "./CardTrigger.module.css";

/**
 * CardTrigger makes an entire card or list row a clickable button.
 *
 * Used for whole-card navigation or selection. The component resets all
 * default button styling (padding, background, border, text alignment) and
 * lets the children provide their own card chrome.
 *
 * The wrapping element is a native `<button type="button">`, so keyboard
 * accessibility is built-in. If children contain other interactive elements
 * (links, buttons, dropdowns), CardTrigger won't work — nested buttons are
 * invalid HTML. Keep content to text, icons, and badges only.
 *
 * @example
 * ```tsx
 * <CardTrigger onClick={() => navigate(id)} aria-label="Open agent details">
 *   <div className="my-card-row">
 *     <Icon name="agent" />
 *     <div>
 *       <h3>{agent.name}</h3>
 *       <p>{agent.status}</p>
 *     </div>
 *   </div>
 * </CardTrigger>
 * ```
 */
export interface CardTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Fired when the card is clicked. */
  onClick: () => void;
  /** Content rendered inside the button. Provide your own card styling. */
  children: React.ReactNode;
  /** Disables the button, preventing clicks and showing reduced opacity. */
  disabled?: boolean;
  /** Accessible label for screen readers. Recommended if children are non-textual. */
  "aria-label"?: string;
}

export const CardTrigger = forwardRef<HTMLButtonElement, CardTriggerProps>(function CardTrigger(
  { onClick, children, disabled = false, className, ...rest },
  ref,
) {
  const cls = [styles.cardTrigger, disabled ? styles.disabled : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} type="button" className={cls} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  );
});

CardTrigger.displayName = "CardTrigger";
