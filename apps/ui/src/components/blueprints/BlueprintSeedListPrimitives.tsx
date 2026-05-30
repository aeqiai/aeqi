import { EmptyState } from "@/components/ui";

export function SeedSearch({
  query,
  onChange,
  placeholder,
}: {
  query: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="ideas-toolbar">
      <span className="ideas-list-search-field">
        <svg
          className="ideas-list-search-glyph"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="5.2" cy="5.2" r="3.2" />
          <path d="M7.6 7.6 L10 10" />
        </svg>
        <input
          className="ideas-list-search"
          type="search"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={(e) => onChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="ideas-list-search-clear"
            onClick={() => onChange("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

export function EmptyKind({ label }: { label: string }) {
  return (
    <EmptyState
      title={`No ${label} in this Blueprint.`}
      description="v1 blueprints ship sparse — not every Blueprint seeds every primitive."
    />
  );
}

export function NoMatch({ query }: { query: string }) {
  return <EmptyState title={`No match for "${query}".`} />;
}
