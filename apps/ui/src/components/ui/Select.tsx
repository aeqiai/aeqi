import { forwardRef, useId } from "react";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "size" | "onChange"
> {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, value, onChange, placeholder, disabled, size = "md", className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id || autoId;

  return (
    <div className={[styles.wrapper, styles[size], className].filter(Boolean).join(" ")}>
      <select
        ref={ref}
        id={selectId}
        className={styles.select}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className={styles.chevron} aria-hidden="true">
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
});

Select.displayName = "Select";
