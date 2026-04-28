import { forwardRef, useId } from "react";
import styles from "./Textarea.module.css";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  /**
   * When `bare=true`, emits only the <textarea> element with accessible
   * attributes (aria-invalid, aria-describedby) but no wrapper div or label/hint/error
   * chrome. Lets pages that embed textarea in custom flex layouts reuse the primitive's
   * styling and a11y without imposing a wrapper.
   *
   * Constraints: `bare` disables label, hint, error rendering. Use only when the
   * parent layout controls text and form state chrome. Pages: ChatComposer, EventCanvasEditor,
   * IdeaCanvas (both), NewAgentPage.
   */
  bare?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, bare = false, ...rest },
  ref,
) {
  const autoId = useId();
  const textareaId = id || autoId;
  const hintId = hint ? `${textareaId}-hint` : undefined;
  const errorId = error ? `${textareaId}-error` : undefined;

  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const textareaEl = (
    <textarea
      ref={ref}
      id={textareaId}
      className={[styles.textarea, error ? styles.hasError : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      {...rest}
    />
  );

  if (bare) {
    return textareaEl;
  }

  return (
    <div className={styles.wrapper}>
      {label && (
        <label className={styles.label} htmlFor={textareaId}>
          {label}
        </label>
      )}
      {textareaEl}
      {hint && !error && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

Textarea.displayName = "Textarea";
