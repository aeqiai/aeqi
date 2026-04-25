import { useEffect } from "react";

/**
 * /protocol — the aeqi protocol surface.
 *
 * Read-only view into what aeqi speaks: the four primitive shapes
 * (agents / events / quests / ideas), event signatures, channel adapters,
 * credential lifecycles, MCP server registry. Operator-facing transparency
 * — "what is the runtime doing right now" rather than "what should I
 * configure". User-root scope (no agent prefix).
 *
 * Stub for now. Future surfaces this will host:
 *   - Live event-pattern catalog (lifecycle + custom)
 *   - Tool registry browser (native + MCP-discovered)
 *   - Channel adapter inventory + status
 *   - Credential lifecycle audit (mirrors `aeqi doctor` reason codes)
 *   - Schema migration history
 */
export default function ProtocolPage() {
  useEffect(() => {
    document.title = "protocol · æqi";
  }, []);

  return (
    <div className="protocol-page">
      <div className="protocol-page-inner">
        <h1 className="protocol-page-title">protocol</h1>
        <p className="protocol-page-lede">
          The wire-level truth of what aeqi speaks. Coming next: live event-pattern catalog, tool
          registry browser, channel inventory, and credential lifecycle audit.
        </p>
      </div>
    </div>
  );
}
