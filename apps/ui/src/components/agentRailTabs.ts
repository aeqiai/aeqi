/**
 * Agent rail tabs for the SETTINGS sub-surface. Kept in a tiny module so
 * AppLayout can render the settings rail without eagerly importing the
 * drilled-agent chat surface.
 */
export const AGENT_RAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "quests", label: "Quests" },
  { id: "events", label: "Events" },
  { id: "ideas", label: "Ideas" },
  { id: "channels", label: "Channels" },
  { id: "treasury", label: "Treasury" },
  { id: "tools", label: "Tools" },
  { id: "integrations", label: "Integrations" },
];
