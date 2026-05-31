import { roleTypeLabel, type CompanyMapEdge, type CompanyMapNode } from "@/lib/companyRoleContext";

interface CompanyMapEdgePathProps {
  edge: CompanyMapEdge;
  layout: Map<string, CompanyMapNode>;
  active: boolean;
  onSelect?: () => void;
}

export default function CompanyMapEdgePath({
  edge,
  layout,
  active,
  onSelect,
}: CompanyMapEdgePathProps) {
  const from = layout.get(edge.from);
  const to = layout.get(edge.to);
  if (!from || !to) return null;

  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const midX = startX + (endX - startX) / 2 - 48;
  const midY = startY + (endY - startY) / 2 - 13;

  return (
    <g>
      <path
        className={[
          "company-context-map-edge",
          `company-context-map-edge--${edge.relation}`,
          edge.role ? "company-context-map-edge--role" : "company-context-map-edge--identity",
          active ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        d={`M ${startX} ${startY} C ${startX + 92} ${startY}, ${endX - 92} ${endY}, ${endX} ${endY}`}
      />
      {edge.role ? (
        <foreignObject x={midX} y={midY} width="96" height="26" className="company-context-edge-fo">
          <button
            type="button"
            className={active ? "company-context-edge-pill is-active" : "company-context-edge-pill"}
            onClick={onSelect}
            title={`Activate ${edge.role.title}`}
          >
            {roleTypeLabel(edge.role.role_type)}
          </button>
        </foreignObject>
      ) : null}
    </g>
  );
}
