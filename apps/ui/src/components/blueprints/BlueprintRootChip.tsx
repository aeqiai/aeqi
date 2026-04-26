import type { CompanyTemplate } from "@/lib/types";

interface BlueprintRootChipProps {
  root: NonNullable<CompanyTemplate["root"]>;
}

export function BlueprintRootChip({ root }: BlueprintRootChipProps) {
  const modelLabel = (root.model || "").replace(/^anthropic\//, "");
  if (!root.model && !root.color) return null;
  return (
    <div className="bp-detail-root-chip">
      {root.color && (
        <span
          className="bp-detail-root-swatch"
          style={{ background: root.color }}
          aria-hidden="true"
        />
      )}
      <span className="bp-detail-root-name">{root.name}</span>
      {modelLabel && <span className="bp-detail-root-model">{modelLabel}</span>}
    </div>
  );
}
