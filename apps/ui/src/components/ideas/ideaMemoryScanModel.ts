import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import type { BadgeVariant } from "../ui";
import type { IdeaTreeRow } from "./ideaTree";
import {
  ideaScopeLabel,
  ideaSourceClarityLabel,
  ideaSourceConfidenceLabel,
  ideaSourceDetailLabel,
  ideaSourceEvidenceLabel,
  ideaSourceLabel,
  ideaSourceOriginLabel,
  knowledgePackActionLabel,
  knowledgePackChecklistLabel,
  knowledgePackLabel,
  knowledgePackProgressLabel,
  knowledgePackReadinessLabel,
  knowledgePackStageLabel,
  memoryReadinessLabel,
  relationshipCountFor,
  relationshipLabelFor,
  tagCoverageLabel,
  topTagSummaryLabel,
} from "./ideaRowSignals";

export type ScanMetric = {
  key: string;
  label: string;
  variant: BadgeVariant;
  dot?: boolean;
};

export type ScanTargetCheck = {
  key: string;
  label: string;
  variant: BadgeVariant;
};

export type ScanTarget = {
  id: string;
  name: string;
  reason: string;
  readiness: string;
  missingSummary: string;
  detail: string;
  checks: ScanTargetCheck[];
  variant: BadgeVariant;
  priority: number;
};

export type MemoryScan = {
  summary: string;
  workQueue: ScanMetric[];
  metrics: ScanMetric[];
  pillars: ScanMetric[];
  targets: ScanTarget[];
  targetTotal: number;
};

export interface BuildMemoryScanInput {
  agentId: string;
  childCounts: Map<string, number>;
  treeRows: IdeaTreeRow[];
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function memoryScanSummary({
  packReadyCount,
  packNeedsSourceAndLinksCount,
  packNeedsSourceCount,
  packNeedsLinksCount,
  untaggedCount,
  relatedCount,
}: {
  packReadyCount: number;
  packNeedsSourceAndLinksCount: number;
  packNeedsSourceCount: number;
  packNeedsLinksCount: number;
  untaggedCount: number;
  relatedCount: number;
}): string {
  if (packNeedsSourceAndLinksCount > 0) {
    return `Next: add source + links to ${countLabel(packNeedsSourceAndLinksCount, "pack row")}`;
  }
  if (packNeedsSourceCount > 0) {
    return `Next: add source detail to ${countLabel(packNeedsSourceCount, "pack row")}`;
  }
  if (packNeedsLinksCount > 0) {
    return `Next: link ${countLabel(packNeedsLinksCount, "pack row")} to related memory`;
  }
  if (packReadyCount > 0) {
    return `Ready: ${countLabel(packReadyCount, "pack row")} ${
      packReadyCount === 1 ? "has" : "have"
    } source + links`;
  }
  if (untaggedCount > 0) return `Next: tag ${countLabel(untaggedCount, "row")} for better recall`;
  if (relatedCount === 0) return "Next: add links or child ideas to connect memory";
  return "Tags, source clarity, and relationships are visible";
}

function packTargetReason(packAction: string): string {
  if (packAction.includes("source + links")) return "Source + links";
  if (packAction.includes("source")) return "Add source";
  if (packAction.includes("links")) return "Link memory";
  return "Review pack";
}

function scanTargetDetail({
  packLabel,
  sourceClarityLabel,
  relationshipLabel,
  tagLabel,
  scopeLabel,
}: {
  packLabel: string | null;
  sourceClarityLabel: string;
  relationshipLabel: string | null;
  tagLabel: string;
  scopeLabel: string;
}): string {
  const parts = [
    packLabel,
    sourceClarityLabel,
    relationshipLabel ?? "No linked memory",
    tagLabel,
    `${scopeLabel} scope`,
  ];
  const seen = new Set<string>();
  return parts
    .filter((part): part is string => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join(" / ");
}

function scanTargetChecks({
  tags,
  hasSourceDetail,
  sourceEvidenceLabel,
  relationshipCount,
  packStage,
  scopeLabel,
}: {
  tags: string[];
  hasSourceDetail: boolean;
  sourceEvidenceLabel: string;
  relationshipCount: number;
  packStage: string | null;
  scopeLabel: string;
}): ScanTargetCheck[] {
  const checks: ScanTargetCheck[] = [];
  if (packStage) {
    checks.push({
      key: "pack",
      label: packStage,
      variant: hasSourceDetail && relationshipCount > 0 ? "success" : "warning",
    });
  }
  checks.push(
    {
      key: "tags",
      label: tags.length > 0 ? "Tags ready" : "Tags missing",
      variant: tags.length > 0 ? "success" : "warning",
    },
    {
      key: "source",
      label: hasSourceDetail ? sourceEvidenceLabel : "Source missing",
      variant: hasSourceDetail ? "success" : "warning",
    },
    {
      key: "links",
      label: relationshipCount > 0 ? "Links ready" : "Links missing",
      variant: relationshipCount > 0 ? "success" : "warning",
    },
    {
      key: "scope",
      label: `${scopeLabel} scope`,
      variant: "neutral",
    },
  );
  return checks;
}

function scanTargetMissingSummary(checks: ScanTargetCheck[]): string {
  const missing = checks
    .filter((check) => check.variant === "warning")
    .map((check) => {
      if (check.key === "tags") return "tags";
      if (check.key === "source") return "source";
      if (check.key === "links") return "links";
      return null;
    })
    .filter((part): part is "tags" | "source" | "links" => part !== null);
  return missing.length > 0 ? `Needs ${missing.join(" + ")}` : "Ready to pack";
}

function scanMetrics(input: {
  scopeMix: Map<string, number>;
  visibleTagCounts: Map<string, number>;
  packCoreCount: number;
  packDraftCount: number;
  outsideRoleCount: number;
  sourceConfidenceCount: number;
  sourceOriginCount: number;
  packNeedsSourceCount: number;
  packNeedsLinksCount: number;
  visibleCount: number;
}): ScanMetric[] {
  const metrics: ScanMetric[] = [];
  const scopeSummary = [...input.scopeMix.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([scope, count]) => `${count} ${scope}`)
    .join(" / ");
  if (scopeSummary) metrics.push({ key: "scope-mix", label: scopeSummary, variant: "neutral" });
  const tagSummary = topTagSummaryLabel(
    [...input.visibleTagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
  if (tagSummary) metrics.push({ key: "tag-mix", label: tagSummary, variant: "neutral" });
  if (input.packCoreCount > 0 || input.packDraftCount > 0) {
    metrics.push({
      key: "pack-mix",
      label: `Core ${input.packCoreCount} / Draft ${input.packDraftCount}`,
      variant: input.packCoreCount > 0 ? "success" : "warning",
      dot: true,
    });
  }
  if (input.outsideRoleCount > 0) {
    metrics.push({
      key: "scope",
      label: countLabel(input.outsideRoleCount, "outside-role scope"),
      variant: "muted",
    });
  }
  if (input.sourceConfidenceCount > 0) {
    metrics.push({
      key: "source-confidence",
      label: `Confidence ${input.sourceConfidenceCount}/${input.visibleCount}`,
      variant: "info",
      dot: true,
    });
  }
  if (input.sourceOriginCount > 0) {
    metrics.push({
      key: "source-origin",
      label: `Imports ${input.sourceOriginCount}/${input.visibleCount}`,
      variant: "neutral",
    });
  }
  if (input.packNeedsSourceCount > 0) {
    metrics.push({
      key: "pack-source-gaps",
      label: countLabel(input.packNeedsSourceCount, "pack source gap"),
      variant: "warning",
      dot: true,
    });
  }
  if (input.packNeedsLinksCount > 0) {
    metrics.push({
      key: "pack-link-gaps",
      label: countLabel(input.packNeedsLinksCount, "pack link gap"),
      variant: "warning",
      dot: true,
    });
  }
  return metrics;
}

function scanWorkQueue(input: {
  visibleCount: number;
  relatedCount: number;
  missingSourceDetailCount: number;
  untaggedCount: number;
  packReadyCount: number;
}): ScanMetric[] {
  const workQueue: ScanMetric[] = [];
  const linkGapCount = Math.max(0, input.visibleCount - input.relatedCount);
  if (input.missingSourceDetailCount > 0) {
    workQueue.push({
      key: "add-source",
      label: `Add source ${input.missingSourceDetailCount}`,
      variant: "warning",
      dot: true,
    });
  }
  if (linkGapCount > 0) {
    workQueue.push({
      key: "link-memory",
      label: `Link memory ${linkGapCount}`,
      variant: "warning",
      dot: true,
    });
  }
  if (input.untaggedCount > 0) {
    workQueue.push({
      key: "add-tags",
      label: `Add tags ${input.untaggedCount}`,
      variant: "warning",
      dot: true,
    });
  }
  if (input.packReadyCount > 0) {
    workQueue.push({
      key: "ready-packs",
      label: `Ready packs ${input.packReadyCount}`,
      variant: "success",
      dot: true,
    });
  }
  if (workQueue.length === 0) {
    workQueue.push({
      key: "no-scan-gaps",
      label: "No scan gaps",
      variant: "success",
      dot: true,
    });
  }
  return workQueue;
}

export function buildMemoryScan({
  agentId,
  childCounts,
  treeRows,
}: BuildMemoryScanInput): MemoryScan {
  let taggedCount = 0;
  let untaggedCount = 0;
  let relatedCount = 0;
  let relationTotal = 0;
  let packReadyCount = 0;
  let packNeedsSourceAndLinksCount = 0;
  let packNeedsSourceCount = 0;
  let packNeedsLinksCount = 0;
  let packGapCount = 0;
  let packCoreCount = 0;
  let packDraftCount = 0;
  let outsideRoleCount = 0;
  let sourceDetailCount = 0;
  let sourceConfidenceCount = 0;
  let sourceOriginCount = 0;
  let missingSourceDetailCount = 0;
  const scopeMix = new Map<string, number>();
  const visibleTagCounts = new Map<string, number>();
  const targetCandidates: ScanTarget[] = [];

  for (const { node } of treeRows) {
    const idea = node.idea;
    const flatContent = blockTreeToPlainText(idea.content);
    const tags = idea.tags ?? [];
    const wordCount = flatContent.trim().split(/\s+/).filter(Boolean).length;
    const childCount = childCounts.get(idea.id) ?? node.children.length;
    const relationshipCount = relationshipCountFor(flatContent, childCount, idea.properties);
    const sourceLabel = ideaSourceLabel(idea, agentId);
    const sourceDetailLabel = ideaSourceDetailLabel(idea);
    const sourceEvidenceLabel = ideaSourceEvidenceLabel(idea);
    const hasSourceDetail = sourceDetailLabel !== null;
    const scopeLabel = ideaScopeLabel(idea, agentId);
    const knowledgePack = knowledgePackLabel(tags, wordCount, relationshipCount);
    const packAction = knowledgePackActionLabel(
      tags,
      wordCount,
      relationshipCount,
      hasSourceDetail,
    );
    const packProgress = knowledgePackProgressLabel(
      tags,
      wordCount,
      relationshipCount,
      hasSourceDetail,
    );
    const packChecklist = knowledgePackChecklistLabel(
      tags,
      wordCount,
      relationshipCount,
      hasSourceDetail,
    );
    const packReadiness = knowledgePackReadinessLabel(
      tags,
      wordCount,
      relationshipCount,
      hasSourceDetail,
    );
    const packStage = knowledgePackStageLabel(tags, wordCount, relationshipCount, hasSourceDetail);
    const checks = scanTargetChecks({
      tags,
      hasSourceDetail,
      sourceEvidenceLabel,
      relationshipCount,
      packStage,
      scopeLabel,
    });
    const readiness = memoryReadinessLabel({ tags, hasSourceDetail, relationshipCount });
    const missingSummary = scanTargetMissingSummary(checks);
    const targetDetail = scanTargetDetail({
      packLabel: packStage ?? knowledgePack,
      sourceClarityLabel: ideaSourceClarityLabel(idea),
      relationshipLabel: relationshipLabelFor(flatContent, childCount, idea.properties),
      tagLabel: packReadiness ?? packChecklist ?? packProgress ?? tagCoverageLabel(tags),
      scopeLabel,
    });

    if (tags.length > 0) {
      taggedCount += 1;
      for (const tag of tags) visibleTagCounts.set(tag, (visibleTagCounts.get(tag) ?? 0) + 1);
    } else {
      untaggedCount += 1;
    }
    if (relationshipCount > 0) {
      relatedCount += 1;
      relationTotal += relationshipCount;
    }
    if (packAction === "Pack ready") packReadyCount += 1;
    if (packAction === "Pack needs source + links") packNeedsSourceAndLinksCount += 1;
    if (packAction?.includes("source")) packNeedsSourceCount += 1;
    if (packAction?.includes("links")) packNeedsLinksCount += 1;
    if (packAction?.includes("needs")) packGapCount += 1;
    if (knowledgePack === "Pack core") packCoreCount += 1;
    if (knowledgePack === "Pack draft") packDraftCount += 1;
    if (sourceLabel !== "Role memory") outsideRoleCount += 1;
    if (sourceDetailLabel) sourceDetailCount += 1;
    else missingSourceDetailCount += 1;
    if (ideaSourceConfidenceLabel(idea)) sourceConfidenceCount += 1;
    if (ideaSourceOriginLabel(idea)) sourceOriginCount += 1;
    scopeMix.set(scopeLabel, (scopeMix.get(scopeLabel) ?? 0) + 1);

    if (packAction?.includes("needs")) {
      targetCandidates.push({
        id: idea.id,
        name: idea.name,
        reason: packTargetReason(packAction),
        readiness,
        missingSummary,
        detail: targetDetail,
        checks,
        variant: "warning",
        priority: 1,
      });
    } else if (tags.length === 0) {
      targetCandidates.push({
        id: idea.id,
        name: idea.name,
        reason: "Add tags",
        readiness,
        missingSummary,
        detail: targetDetail,
        checks,
        variant: "warning",
        priority: 2,
      });
    } else if (!sourceDetailLabel) {
      targetCandidates.push({
        id: idea.id,
        name: idea.name,
        reason: "Add source",
        readiness,
        missingSummary,
        detail: targetDetail,
        checks,
        variant: "muted",
        priority: 3,
      });
    } else if (relationshipCount === 0) {
      targetCandidates.push({
        id: idea.id,
        name: idea.name,
        reason: "Connect",
        readiness,
        missingSummary,
        detail: targetDetail,
        checks,
        variant: "info",
        priority: 4,
      });
    }
  }

  const visibleCount = treeRows.length;
  const packCount = packReadyCount + packGapCount;
  const targets = targetCandidates.sort((a, b) => a.priority - b.priority).slice(0, 3);
  return {
    summary: memoryScanSummary({
      packReadyCount,
      packNeedsSourceAndLinksCount,
      packNeedsSourceCount,
      packNeedsLinksCount,
      untaggedCount,
      relatedCount,
    }),
    workQueue: scanWorkQueue({
      visibleCount,
      relatedCount,
      missingSourceDetailCount,
      untaggedCount,
      packReadyCount,
    }),
    metrics: scanMetrics({
      scopeMix,
      visibleTagCounts,
      packCoreCount,
      packDraftCount,
      outsideRoleCount,
      sourceConfidenceCount,
      sourceOriginCount,
      packNeedsSourceCount,
      packNeedsLinksCount,
      visibleCount,
    }),
    pillars: [
      {
        key: "tags",
        label: `Tags ${taggedCount}/${visibleCount}${
          untaggedCount > 0 ? ` / ${untaggedCount} missing` : ""
        }`,
        variant: untaggedCount > 0 ? "warning" : "success",
        dot: true,
      },
      {
        key: "source-detail",
        label: `Source detail ${sourceDetailCount}/${visibleCount}${
          missingSourceDetailCount > 0 ? ` / ${missingSourceDetailCount} missing` : ""
        }`,
        variant: missingSourceDetailCount > 0 ? "warning" : "success",
        dot: true,
      },
      {
        key: "relationships",
        label:
          relatedCount > 0
            ? `Links ${relatedCount}/${visibleCount} / ${relationTotal} total`
            : "Links 0 rows",
        variant: relatedCount > 0 ? "info" : "warning",
        dot: true,
      },
      {
        key: "pack-ready",
        label:
          packCount > 0
            ? `Packs ${packReadyCount}/${packCount} ready${
                packGapCount > 0 ? ` / ${packGapCount} gaps` : ""
              }`
            : "Packs none detected",
        variant: packGapCount > 0 ? "warning" : packReadyCount > 0 ? "success" : "muted",
        dot: packCount > 0,
      },
    ],
    targets,
    targetTotal: targetCandidates.length,
  };
}
