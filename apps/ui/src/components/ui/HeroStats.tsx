import React from "react";
import styles from "./HeroStats.module.css";

export interface Stat {
  value: string | number;
  label: string;
  color?: "default" | "muted" | "info" | "success" | "error" | "warning";
}

export interface HeroStatsProps {
  stats: Stat[];
}

export function HeroStats({ stats }: HeroStatsProps) {
  return (
    <div className={styles.wrapper}>
      {stats.map((stat, i) => (
        <React.Fragment key={stat.label}>
          {i > 0 && <div className={styles.divider} />}
          <div className={styles.stat}>
            <div
              className={[
                styles.value,
                stat.color && stat.color !== "default" ? styles[stat.color] : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {stat.value}
            </div>
            <div className={styles.label}>{stat.label}</div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

HeroStats.displayName = "HeroStats";
