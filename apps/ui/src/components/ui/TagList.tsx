interface TagListProps {
  items: string[];
  empty?: string;
}

export default function TagList({ items, empty }: TagListProps) {
  if (!items || items.length === 0) {
    return empty ? <span className="text-hint">{empty}</span> : null;
  }

  return (
    <div className="flex-wrap-tags">
      {items.map((item) => (
        <span key={item} className="expertise-tag">{item}</span>
      ))}
    </div>
  );
}
