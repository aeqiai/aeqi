import styles from "./DetailField.module.css";

export interface DetailFieldProps {
  label: string;
  children: React.ReactNode;
}

export function DetailField({ label, children }: DetailFieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

DetailField.displayName = "DetailField";
