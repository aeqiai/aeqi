interface Stat {
  value: string | number;
  label: string;
  color?: "default" | "muted" | "info" | "success" | "error" | "warning";
}

interface HeroStatsProps {
  stats: Stat[];
}

export default function HeroStats({ stats }: HeroStatsProps) {
  return (
    <div className="hero-stats">
      {stats.map((stat, i) => (
        <React.Fragment key={stat.label}>
          {i > 0 && <div className="hero-stat-divider" />}
          <div className="hero-stat">
            <div
              className={`hero-stat-value${stat.color && stat.color !== "default" ? ` ${stat.color}` : ""}`}
            >
              {stat.value}
            </div>
            <div className="hero-stat-label">{stat.label}</div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

import React from "react";
