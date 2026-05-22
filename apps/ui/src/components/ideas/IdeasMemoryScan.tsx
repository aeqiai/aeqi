import { Link } from "react-router-dom";
import { Badge } from "../ui";
import type { IdeaTreeRow } from "./ideaTree";
import { buildMemoryScan } from "./ideaMemoryScanModel";
import { SCOPE_LABEL, type IdeasFilter } from "./types";

export interface IdeasMemoryScanProps {
  agentId: string;
  childCounts: Map<string, number>;
  filterScope: IdeasFilter;
  folderHref: (ideaId: string) => string;
  treeRows: IdeaTreeRow[];
}

export default function IdeasMemoryScan(props: IdeasMemoryScanProps) {
  const memoryScan = buildMemoryScan(props);
  if (props.treeRows.length === 0) return null;

  return (
    <div className="ideas-memory-scan" aria-label="Memory scan">
      <span className="ideas-memory-scan-label">Memory scan</span>
      <span className="ideas-memory-scan-summary">{memoryScan.summary}</span>
      <div className="ideas-memory-scan-pillars" aria-label="Memory quality">
        {memoryScan.pillars.map((pillar) => (
          <Badge key={pillar.key} variant={pillar.variant} size="sm" dot={pillar.dot}>
            {pillar.label}
          </Badge>
        ))}
      </div>
      <div className="ideas-memory-scan-badges">
        <Badge variant="neutral" size="sm">
          {SCOPE_LABEL[props.filterScope] ?? props.filterScope} scope
        </Badge>
        {memoryScan.metrics.map((metric) => (
          <Badge key={metric.key} variant={metric.variant} size="sm" dot={metric.dot}>
            {metric.label}
          </Badge>
        ))}
      </div>
      {memoryScan.targets.length > 0 && (
        <div className="ideas-memory-scan-queue" aria-label="Memory scan next rows">
          <span className="ideas-memory-scan-queue-label">
            Next rows {memoryScan.targets.length}/{memoryScan.targetTotal}
          </span>
          <span className="ideas-memory-scan-work" aria-label="Memory scan work queue">
            {memoryScan.workQueue.map((metric) => (
              <Badge key={metric.key} variant={metric.variant} size="sm" dot={metric.dot}>
                {metric.label}
              </Badge>
            ))}
          </span>
          {memoryScan.targets.map((target) => (
            <Link
              key={target.id}
              to={props.folderHref(target.id)}
              className="ideas-memory-scan-target"
              title={`${target.reason}: ${target.name}`}
            >
              <Badge variant={target.variant} size="sm" dot>
                {target.reason}
              </Badge>
              <Badge variant={target.readiness === "Ready 3/3" ? "success" : "warning"} size="sm">
                {target.readiness}
              </Badge>
              <Badge
                variant={target.missingSummary === "Ready to pack" ? "success" : "warning"}
                size="sm"
              >
                {target.missingSummary}
              </Badge>
              <span className="ideas-memory-scan-target-copy">
                <span className="ideas-memory-scan-target-name">{target.name}</span>
                <span className="ideas-memory-scan-target-detail">{target.detail}</span>
                <span className="ideas-memory-scan-target-checks" aria-label="Readiness">
                  {target.checks.map((check) => (
                    <Badge key={check.key} variant={check.variant} size="sm" dot>
                      {check.label}
                    </Badge>
                  ))}
                </span>
              </span>
            </Link>
          ))}
          {memoryScan.targetTotal > memoryScan.targets.length && (
            <Badge variant="neutral" size="sm">
              +{memoryScan.targetTotal - memoryScan.targets.length} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
