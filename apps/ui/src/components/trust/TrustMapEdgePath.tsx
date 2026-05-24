import { roleTypeLabel, type TrustMapEdge, type TrustMapNode } from "@/lib/trustRoleContext";

interface TrustMapEdgePathProps {
  edge: TrustMapEdge;
  layout: Map<string, TrustMapNode>;
  active: boolean;
  onSelect?: () => void;
}

export default function TrustMapEdgePath({
  edge,
  layout,
  active,
  onSelect,
}: TrustMapEdgePathProps) {
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
          "trust-context-map-edge",
          `trust-context-map-edge--${edge.relation}`,
          edge.role ? "trust-context-map-edge--role" : "trust-context-map-edge--identity",
          active ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        d={`M ${startX} ${startY} C ${startX + 92} ${startY}, ${endX - 92} ${endY}, ${endX} ${endY}`}
      />
      {edge.role ? (
        <foreignObject x={midX} y={midY} width="96" height="26" className="trust-context-edge-fo">
          <button
            type="button"
            className={active ? "trust-context-edge-pill is-active" : "trust-context-edge-pill"}
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
