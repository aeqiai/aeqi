/**
 * Agent rail tabs for the SETTINGS sub-surface. Kept in a tiny module so
 * AppLayout can render the settings rail without eagerly importing the
 * drilled-agent chat surface. Treasury was retired from the pre-MVP UI;
 * on-chain/indexer support remains below the page layer.
 */
export const AGENT_RAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "quests", label: "Quests" },
  { id: "events", label: "Events" },
  { id: "ideas", label: "Ideas" },
  { id: "channels", label: "Gateways" },
  { id: "tools", label: "Tools" },
  { id: "integrations", label: "Integrations" },
];
