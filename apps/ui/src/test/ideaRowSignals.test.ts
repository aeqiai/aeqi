import { describe, expect, it } from "vitest";
import type { Idea } from "@/lib/types";
import {
  ideaScopeLabel,
  ideaSourceClarityLabel,
  ideaSourceConfidenceLabel,
  ideaSourceDetailLabel,
  ideaSourceEvidenceLabel,
  ideaSourceLabel,
  ideaSourceOriginLabel,
  ideaPrimarySignalLabel,
  ideaSignalTone,
  isRelationshipPropertyKey,
  isSourceMetadataPropertyKey,
  isSourcePropertyKey,
  knowledgePackChecklistLabel,
  knowledgePackActionLabel,
  knowledgePackLabel,
  knowledgePackProgressLabel,
  knowledgePackReadinessLabel,
  knowledgePackStageLabel,
  memoryReadinessLabel,
  relationshipCountFor,
  relationshipLabelFor,
  relationshipSummaryLabelFor,
  tagCoverageLabel,
  topTagSummaryLabel,
} from "@/components/ideas/ideaRowSignals";

function idea(patch: Partial<Idea> = {}): Idea {
  return {
    id: "idea-1",
    name: "Idea",
    content: "",
    tags: [],
    agent_id: "agent-1",
    ...patch,
  };
}

describe("idea row signals", () => {
  it("labels inherited, global, and role-scoped memory distinctly", () => {
    expect(ideaScopeLabel(idea(), "agent-1")).toBe("Self");
    expect(ideaSourceLabel(idea(), "agent-1")).toBe("Role memory");

    expect(ideaScopeLabel(idea({ agent_id: "agent-2" }), "agent-1")).toBe("Inherited");
    expect(ideaSourceLabel(idea({ agent_id: "agent-2" }), "agent-1")).toBe("Inherited memory");

    expect(ideaScopeLabel(idea({ agent_id: undefined, scope: "global" }), "agent-1")).toBe(
      "Global",
    );
    expect(ideaSourceLabel(idea({ agent_id: undefined, scope: "global" }), "agent-1")).toBe(
      "Global memory",
    );
  });

  it("surfaces concrete source details from files and source properties", () => {
    expect(ideaSourceDetailLabel(idea({ kind: "file" }))).toBe("Source: file");
    expect(ideaSourceClarityLabel(idea({ kind: "file" }))).toBe("Source: file");
    expect(
      ideaSourceDetailLabel(
        idea({ properties: { url: "https://docs.example.com/guide/intro?x=1" } }),
      ),
    ).toBe("Source: docs.example.com");
    expect(ideaSourceDetailLabel(idea({ properties: { path: "/notes/runtime.md" } }))).toBe(
      "Source: runtime.md",
    );
    expect(
      ideaSourceDetailLabel(
        idea({
          properties: {
            sources: ["https://docs.example.com/guide/intro", "/notes/runtime.md"],
          },
        }),
      ),
    ).toBe("Source: docs.example.com +1");
    expect(
      ideaSourceDetailLabel(idea({ properties: { source: { href: "/notes/decision.md" } } })),
    ).toBe("Source: decision.md");
    expect(ideaSourceDetailLabel(idea({ properties: { references: ["/notes/brief.md"] } }))).toBe(
      "Source: brief.md",
    );
    expect(ideaSourceDetailLabel(idea({ properties: { link: "https://aeqi.ai/brand" } }))).toBe(
      "Source: aeqi.ai",
    );
    expect(
      ideaSourceDetailLabel(idea({ properties: { source_title: "Runtime design note" } })),
    ).toBe("Source: Runtime design note");
    expect(
      ideaSourceDetailLabel(idea({ properties: { citations: ["https://example.com/paper"] } })),
    ).toBe("Source: example.com");
    expect(ideaSourceDetailLabel(idea({ properties: { origin_url: "/notes/origin.md" } }))).toBe(
      "Source: origin.md",
    );
    expect(ideaSourceOriginLabel(idea({ properties: { imported_from: "/notes/import.md" } }))).toBe(
      "Imported: import.md",
    );
    expect(ideaSourceClarityLabel(idea())).toBe("No source detail");
  });

  it("identifies source property keys for table column de-duplication", () => {
    expect(isSourcePropertyKey("source")).toBe(true);
    expect(isSourcePropertyKey("source_title")).toBe(true);
    expect(isSourcePropertyKey("citation")).toBe(true);
    expect(isSourcePropertyKey("SOURCE_URL")).toBe(true);
    expect(isSourcePropertyKey("path")).toBe(true);
    expect(isSourcePropertyKey("confidence")).toBe(false);
    expect(isSourceMetadataPropertyKey("confidence")).toBe(true);
    expect(isSourceMetadataPropertyKey("source_confidence_pct")).toBe(true);
    expect(isSourceMetadataPropertyKey("imported_from")).toBe(true);
    expect(isSourceMetadataPropertyKey("owner")).toBe(false);
    expect(isRelationshipPropertyKey("related_ideas")).toBe(true);
    expect(isRelationshipPropertyKey("see_also")).toBe(true);
    expect(isRelationshipPropertyKey("supersedes")).toBe(true);
    expect(isRelationshipPropertyKey("depends_on")).toBe(true);
    expect(isRelationshipPropertyKey("owner")).toBe(false);
  });

  it("normalizes source confidence from properties", () => {
    expect(ideaSourceConfidenceLabel(idea({ properties: { confidence: 0.82 } }))).toBe(
      "82% confidence",
    );
    expect(ideaSourceConfidenceLabel(idea({ properties: { source_confidence_pct: "91%" } }))).toBe(
      "91% confidence",
    );
    expect(ideaSourceConfidenceLabel(idea({ properties: { confidence: "verified" } }))).toBe(
      "Verified confidence",
    );
  });

  it("summarizes source evidence completeness without repeating source detail", () => {
    expect(ideaSourceEvidenceLabel(idea())).toBe("Evidence missing");
    expect(ideaSourceEvidenceLabel(idea({ kind: "file" }))).toBe("Evidence: file");
    expect(ideaSourceEvidenceLabel(idea({ properties: { source_title: "Runtime note" } }))).toBe(
      "Evidence: named",
    );
    expect(
      ideaSourceEvidenceLabel(
        idea({
          properties: {
            source: "/notes/import.md",
            imported_from: "/notes/source.md",
            source_confidence: 0.91,
          },
        }),
      ),
    ).toBe("Evidence: import + confidence");
  });

  it("reads source and relationship metadata with case-insensitive property names", () => {
    const mixedCaseIdea = idea({
      properties: {
        SOURCE_URL: "https://docs.example.com/caps",
        Imported_From: "caps-import.md",
        SOURCE_CONFIDENCE_PCT: "88%",
        Related_Ideas: [{ Title: "Case Study" }],
      },
    });

    expect(ideaSourceDetailLabel(mixedCaseIdea)).toBe("Source: docs.example.com");
    expect(ideaSourceOriginLabel(mixedCaseIdea)).toBe("Imported: caps-import.md");
    expect(ideaSourceConfidenceLabel(mixedCaseIdea)).toBe("88% confidence");
    expect(relationshipCountFor("", 0, mixedCaseIdea.properties)).toBe(1);
    expect(relationshipLabelFor("", 0, mixedCaseIdea.properties)).toBe("related Case Study");
  });

  it("counts unique wiki relationships plus child rows", () => {
    expect(relationshipCountFor("[[Alpha]] and ![[alpha]] plus [[Beta]]", 2)).toBe(4);
    expect(relationshipLabelFor("[[Alpha]] and ![[alpha]] plus [[Beta]]", 2)).toBe(
      "links Alpha, Beta / embeds alpha / 2 child ideas",
    );
  });

  it("separates linked and embedded memory labels", () => {
    expect(relationshipLabelFor("[[Alpha]] [[Beta]] [[Gamma]] ![[Delta]] ![[Echo]]", 0)).toBe(
      "links Alpha, Beta +1 / embeds Delta, Echo",
    );
  });

  it("summarizes relationship counts for compact row chips", () => {
    expect(relationshipSummaryLabelFor("[[Alpha]] [[Beta]] ![[Delta]]", 2)).toBe(
      "2 links / 1 embed / 2 child ideas",
    );
  });

  it("counts explicit relationship properties as linked memory", () => {
    const properties = {
      related_ideas: ["Alpha", { name: "Beta" }, "[[Gamma]]"],
      linked_ideas: ["Alpha"],
      see_also: [{ target: "Delta" }],
    };

    expect(relationshipCountFor("[[Alpha]]", 1, properties)).toBe(5);
    expect(relationshipSummaryLabelFor("[[Alpha]]", 1, properties)).toBe(
      "1 link / 3 related / 1 see also / 1 child idea",
    );
    expect(relationshipLabelFor("[[Alpha]]", 1, properties)).toBe(
      "links Alpha / related Alpha, Beta +1 / see also Delta / 1 child idea",
    );
  });

  it("keeps typed relationship property verbs visible", () => {
    const properties = {
      depends_on: ["Runtime plan"],
      supports: [{ title: "Launch criteria" }],
      supersedes: "Old checklist",
      contradicts: "Draft assumption",
    };

    expect(relationshipSummaryLabelFor("", 0, properties)).toBe(
      "1 depends on / 1 supersedes / 1 supports / 1 contradicts",
    );
    expect(relationshipLabelFor("", 0, properties)).toBe(
      "depends on Runtime plan / supersedes Old checklist / supports Launch criteria / contradicts Draft assumption",
    );
  });

  it("promotes durable tagged ideas into knowledge packs", () => {
    const contentWordCount = 24;
    expect(knowledgePackLabel(["decision"], contentWordCount, 0)).toBe("Pack core");
    expect(knowledgePackLabel(["project", "notes"], 80, 0)).toBe("Pack draft");
    expect(knowledgePackLabel(["skill", "candidate"], contentWordCount, 0)).toBe("Pack draft");
    expect(knowledgePackLabel(["skill", "rejected"], contentWordCount, 1)).toBeNull();
  });

  it("keeps review candidates in warning tone until promoted", () => {
    expect(ideaSignalTone(["skill", "candidate"], "Candidate", "Pack core")).toBe("warning");
    expect(ideaSignalTone(["decision"], "Decision", "Pack core")).toBe("success");
  });

  it("prioritizes knowledge-pack readiness gaps over durable-pack status", () => {
    expect(ideaSignalTone(["decision"], "Decision", "Pack core", "Pack needs source + links")).toBe(
      "warning",
    );
    expect(ideaSignalTone(["decision"], "Decision", "Pack core", "Pack ready")).toBe("success");
    expect(ideaSignalTone(["skill", "candidate"], "Candidate", "Pack draft", "Pack ready")).toBe(
      "warning",
    );
  });

  it("keeps review candidates as the primary row signal", () => {
    expect(
      ideaPrimarySignalLabel({
        decision: "Candidate",
        knowledgePack: "Pack draft",
        packAction: "Pack ready",
        relationshipCount: 1,
        sourceLabel: "Role memory",
      }),
    ).toBe("Candidate");
    expect(
      ideaPrimarySignalLabel({
        decision: "Decision",
        knowledgePack: "Pack core",
        packAction: "Pack ready",
        relationshipCount: 1,
        sourceLabel: "Role memory",
      }),
    ).toBe("Pack ready");
  });

  it("names knowledge-pack readiness gaps", () => {
    expect(knowledgePackActionLabel(["decision"], 24, 0, false)).toBe("Pack needs source + links");
    expect(knowledgePackActionLabel(["decision"], 24, 1, false)).toBe("Pack needs source");
    expect(knowledgePackActionLabel(["decision"], 24, 0, true)).toBe("Pack needs links");
    expect(knowledgePackActionLabel(["decision"], 24, 1, true)).toBe("Pack ready");
    expect(knowledgePackActionLabel(["scratch"], 8, 0, false)).toBeNull();
  });

  it("summarizes knowledge-pack readiness as a compact progress label", () => {
    expect(knowledgePackProgressLabel(["decision"], 24, 0, false)).toBe("Pack 1/3");
    expect(knowledgePackProgressLabel(["decision"], 24, 1, false)).toBe("Pack 2/3");
    expect(knowledgePackProgressLabel(["decision"], 24, 1, true)).toBe("Pack 3/3");
    expect(knowledgePackProgressLabel(["scratch"], 8, 0, false)).toBeNull();
  });

  it("summarizes knowledge-pack readiness with the missing work inline", () => {
    expect(knowledgePackReadinessLabel(["decision"], 24, 0, false)).toBe(
      "1/3 ready: missing source + links",
    );
    expect(knowledgePackReadinessLabel(["decision"], 24, 1, false)).toBe(
      "2/3 ready: missing source",
    );
    expect(knowledgePackReadinessLabel(["decision"], 24, 0, true)).toBe("2/3 ready: missing links");
    expect(knowledgePackReadinessLabel(["decision"], 24, 1, true)).toBe(
      "3/3 ready: source + links",
    );
    expect(knowledgePackReadinessLabel(["scratch"], 8, 0, false)).toBeNull();
  });

  it("combines pack type with the usability blocker", () => {
    expect(knowledgePackStageLabel(["decision"], 24, 0, false)).toBe(
      "Pack core needs source + links",
    );
    expect(knowledgePackStageLabel(["decision"], 24, 1, false)).toBe("Pack core needs source");
    expect(knowledgePackStageLabel(["decision"], 24, 0, true)).toBe("Pack core needs links");
    expect(knowledgePackStageLabel(["decision"], 24, 1, true)).toBe("Pack core ready");
    expect(knowledgePackStageLabel(["scratch"], 8, 0, false)).toBeNull();
  });

  it("summarizes row readiness across tags, source, and relationships", () => {
    expect(memoryReadinessLabel({ tags: [], hasSourceDetail: false, relationshipCount: 0 })).toBe(
      "Ready 0/3",
    );
    expect(
      memoryReadinessLabel({ tags: ["decision"], hasSourceDetail: false, relationshipCount: 1 }),
    ).toBe("Ready 2/3");
    expect(
      memoryReadinessLabel({
        tags: ["decision"],
        hasSourceDetail: true,
        relationshipCount: 1,
      }),
    ).toBe("Ready 3/3");
  });

  it("names knowledge-pack checklist gaps as actions", () => {
    expect(knowledgePackChecklistLabel(["decision"], 24, 0, false)).toBe("Missing source + links");
    expect(knowledgePackChecklistLabel(["decision"], 24, 1, false)).toBe("Missing source");
    expect(knowledgePackChecklistLabel(["decision"], 24, 0, true)).toBe("Missing links");
    expect(knowledgePackChecklistLabel(["decision"], 24, 1, true)).toBe("Source + links ready");
    expect(knowledgePackChecklistLabel(["scratch"], 8, 0, false)).toBeNull();
  });

  it("summarizes tag coverage gaps and dense tag sets", () => {
    expect(tagCoverageLabel([])).toBe("No tags");
    expect(tagCoverageLabel(["skill"])).toBe("#skill");
    expect(tagCoverageLabel(["decision", "runtime", "evergreen"])).toBe(
      "3 tags: #decision, #runtime +1",
    );
  });

  it("summarizes the visible memory tag mix for scan badges", () => {
    expect(topTagSummaryLabel([])).toBeNull();
    expect(
      topTagSummaryLabel([
        ["decision", 6],
        ["skill", 3],
        ["runtime", 2],
        ["evergreen", 1],
      ]),
    ).toBe("#decision 6 / #skill 3 / #runtime 2 / +1");
  });
});
