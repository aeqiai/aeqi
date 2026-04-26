import type { CompanyTemplate } from "@/lib/types";

interface BlueprintTreePreviewProps {
  template: CompanyTemplate;
}

export function BlueprintTreePreview({ template }: BlueprintTreePreviewProps) {
  const seeds = template.seed_agents ?? [];
  const rootName = template.root?.name ?? template.name;
  const rootColor = template.root?.color;
  return (
    <div className="bp-tree" aria-hidden="true">
      <div className="bp-tree-root">
        <span
          className="bp-tree-node bp-tree-node-root"
          style={rootColor ? { background: rootColor, borderColor: rootColor } : undefined}
        >
          <span className="bp-tree-node-name">{rootName}</span>
          <span className="bp-tree-node-tag">root</span>
        </span>
      </div>
      {seeds.length > 0 && (
        <>
          <svg className="bp-tree-edges" viewBox="0 0 100 18" preserveAspectRatio="none">
            {seeds.map((_, i) => {
              const total = seeds.length;
              const x = total === 1 ? 50 : 16 + (i * 68) / Math.max(1, total - 1);
              return (
                <path
                  key={i}
                  d={`M50 0 C50 8 ${x} 8 ${x} 18`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.6"
                  strokeOpacity="0.45"
                />
              );
            })}
          </svg>
          <ul className="bp-tree-children">
            {seeds.map((seed, i) => {
              const tip = seed.system_prompt || seed.tagline || seed.role || seed.name;
              return (
                <li
                  key={`${seed.name}-${i}`}
                  className="bp-tree-node bp-tree-node-child"
                  style={{
                    animationDelay: `${100 + i * 80}ms`,
                    ...(seed.color ? { borderColor: seed.color } : {}),
                  }}
                  title={tip}
                >
                  {seed.color && (
                    <span
                      className="bp-tree-node-swatch"
                      style={{ background: seed.color }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="bp-tree-node-name">{seed.name}</span>
                  {seed.role && <span className="bp-tree-node-tag">{seed.role}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
