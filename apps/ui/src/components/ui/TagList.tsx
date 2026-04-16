import styles from "./TagList.module.css";

export interface TagListProps {
  items: string[];
  empty?: string;
}

export function TagList({ items, empty }: TagListProps) {
  if (!items || items.length === 0) {
    return empty ? <span className={styles.empty}>{empty}</span> : null;
  }

  return (
    <div className={styles.wrapper}>
      {items.map((item) => (
        <span key={item} className={styles.tag}>
          {item}
        </span>
      ))}
    </div>
  );
}

TagList.displayName = "TagList";
