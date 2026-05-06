import { describe, expect, it } from "vitest";
import { reRootEdges } from "@/components/roles/layout";
import type { RoleEdge } from "@/lib/types";

/**
 * AEIQ-shaped fixture — same shape that produced the "Blockchain Advisor as
 * leader" bug in production:
 *
 *   director (human)         — board, no edges
 *   ceo      (human) ──┬─── cfo (agent)
 *                      ├─── cmo (agent)
 *                      ├─── cto (vacant) ── be_eng (agent)
 *                      └─── coo (vacant) ── coo_asst (agent)
 *   advisor_blockchain (agent) — orphan
 *   advisor_legal      (agent) — orphan
 */
const EDGES: RoleEdge[] = [
  { parent_role_id: "ceo", child_role_id: "cfo" },
  { parent_role_id: "ceo", child_role_id: "cmo" },
  { parent_role_id: "ceo", child_role_id: "cto" },
  { parent_role_id: "ceo", child_role_id: "coo" },
  { parent_role_id: "cto", child_role_id: "be_eng" },
  { parent_role_id: "coo", child_role_id: "coo_asst" },
];

describe("reRootEdges", () => {
  it("returns no edges when subset is empty", () => {
    expect(reRootEdges(new Set(), EDGES)).toEqual([]);
  });

  it("preserves direct edges between subset members", () => {
    // CEO + CFO both in the subset → CEO -> CFO survives.
    const subset = new Set(["ceo", "cfo"]);
    const out = reRootEdges(subset, EDGES);
    expect(out).toEqual([{ parent_role_id: "ceo", child_role_id: "cfo" }]);
  });

  it("contracts a chain through a single non-subset intermediary (vacant CTO between CEO and BE engineer)", () => {
    // Subset = CEO + Backend Engineer. Original chain: CEO -> CTO(vacant) -> BE.
    // Re-rooted: CEO -> BE (CTO is skipped).
    const subset = new Set(["ceo", "be_eng"]);
    const out = reRootEdges(subset, EDGES);
    expect(out).toEqual([{ parent_role_id: "ceo", child_role_id: "be_eng" }]);
  });

  it("AEIQ agents-only — every C-suite agent and grandchild becomes a root since CEO is human", () => {
    // Agent subset (matches the production bug shape).
    const subset = new Set([
      "cfo",
      "cmo",
      "be_eng",
      "coo_asst",
      "advisor_blockchain",
      "advisor_legal",
    ]);
    const out = reRootEdges(subset, EDGES);
    // No edges should be emitted: every agent's nearest agent ancestor is null
    // because the chain above them is human (CEO) or vacant (CTO/COO).
    expect(out).toEqual([]);
  });

  it("agent reports nest under agent ancestor when one exists", () => {
    // Add an agent intermediary: ceo (human) -> cfo (agent) -> finance_analyst (agent).
    const edges: RoleEdge[] = [
      { parent_role_id: "ceo", child_role_id: "cfo" },
      { parent_role_id: "cfo", child_role_id: "finance_analyst" },
    ];
    const subset = new Set(["cfo", "finance_analyst"]);
    const out = reRootEdges(subset, edges);
    expect(out).toEqual([{ parent_role_id: "cfo", child_role_id: "finance_analyst" }]);
  });

  it("orphan roles (no parents at all, like advisors) emit no edges", () => {
    const subset = new Set(["advisor_blockchain", "advisor_legal"]);
    const out = reRootEdges(subset, EDGES);
    expect(out).toEqual([]);
  });

  it("survives a cycle in the input edges (defensive — DAG should be acyclic)", () => {
    const cyclic: RoleEdge[] = [
      { parent_role_id: "a", child_role_id: "b" },
      { parent_role_id: "b", child_role_id: "c" },
      { parent_role_id: "c", child_role_id: "a" },
    ];
    // Subset {a, c} — each element walks up to find the other; both edges
    // emit. Critical assertion: the function terminates (no infinite loop)
    // and returns exactly one edge per subset child via the visited set.
    const out = reRootEdges(new Set(["a", "c"]), cyclic);
    expect(out).toHaveLength(2);
    expect(out).toEqual(
      expect.arrayContaining([
        { parent_role_id: "a", child_role_id: "c" },
        { parent_role_id: "c", child_role_id: "a" },
      ]),
    );
  });

  it("diamond: closest ancestor in subset wins (BFS by parent depth)", () => {
    // Two paths from x to z: x -> y -> z and x -> z. Both valid; the direct
    // x -> z edge is in the parents-of map, BFS hits x via the direct edge
    // first (depth 1) before via y (depth 2).
    const diamond: RoleEdge[] = [
      { parent_role_id: "x", child_role_id: "y" },
      { parent_role_id: "x", child_role_id: "z" },
      { parent_role_id: "y", child_role_id: "z" },
    ];
    const subset = new Set(["x", "z"]);
    const out = reRootEdges(subset, diamond);
    expect(out).toEqual([{ parent_role_id: "x", child_role_id: "z" }]);
  });
});
