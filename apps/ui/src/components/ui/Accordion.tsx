import { useState, forwardRef } from "react";
import type { ReactNode } from "react";
import styles from "./Accordion.module.css";

export interface AccordionItemProps {
  /** Question or label text. */
  question: string;
  /** Answer content; can include JSX and markup. */
  children: ReactNode;
  /** Whether the item starts open. Defaults to false. */
  defaultOpen?: boolean;
  /** Optional id for deep-linking or external focus control. */
  id?: string;
}

export interface AccordionProps {
  /** Array of accordion items. */
  children: ReactNode;
}

/** Individual accordion item with question, chevron toggle, and collapsible answer. */
export const AccordionItem = forwardRef<HTMLButtonElement, AccordionItemProps>(
  ({ question, children, defaultOpen = false, id }, ref) => {
    const [open, setOpen] = useState(defaultOpen);

    return (
      <div className={styles.item}>
        <button
          ref={ref}
          id={id}
          onClick={() => setOpen(!open)}
          className={styles.button}
          aria-expanded={open}
        >
          <span className={styles.question}>{question}</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
            aria-hidden="true"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        {open && <div className={styles.answer}>{children}</div>}
      </div>
    );
  },
);

AccordionItem.displayName = "Accordion.Item";

/** Accordion compound component. Wrapper for AccordionItem elements. */
export function Accordion({ children }: AccordionProps) {
  return <div className={styles.root}>{children}</div>;
}

Accordion.Item = AccordionItem;
Accordion.displayName = "Accordion";
