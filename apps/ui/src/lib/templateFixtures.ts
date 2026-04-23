import type { CompanyTemplate } from "@/lib/types";

/**
 * Local fallback catalog. Used only when the real `/api/templates` endpoint
 * errors (Stream C not live yet, network down, etc.) so /templates never
 * renders an empty void at runtime.
 *
 * The three canonical 0.8 templates — kept in sync with the founder's MVP
 * spec: Solo Founder, Studio, Small Business. Seed shapes are intentionally
 * light here (name + short description); the backend is the source of truth
 * for the actual agents/events/ideas/quests that get spawned.
 */
export const FALLBACK_TEMPLATES: CompanyTemplate[] = [
  {
    slug: "solo-founder",
    name: "Solo Founder",
    tagline: "Ship product. Talk to users. Stay shipping.",
    description:
      "A lean operator for one-person companies. Wakes up with a product manager, an engineer, and a growth agent already threaded — plus a rolling backlog that keeps you moving from idea to revenue.",
    tags: ["founder", "startup", "product"],
    seed_agents: [
      {
        name: "Operator",
        tagline: "The founder's right hand.",
        role: "Company root. Delegates to specialists, keeps the roadmap honest.",
      },
      {
        name: "Product",
        tagline: "User-obsessed.",
        role: "Turns signal into spec. Owns the what.",
      },
      {
        name: "Engineer",
        tagline: "Ships.",
        role: "Implements. Owns the how.",
      },
      {
        name: "Growth",
        tagline: "Distribution is product.",
        role: "Content, outreach, and measurement.",
      },
    ],
    seed_events: [
      { pattern: "session:start", name: "Daily stand-in" },
      { pattern: "quest:done", name: "Ship announcement" },
    ],
    seed_ideas: [
      { name: "how-to-create-a-quest", tags: ["skill"] },
      { name: "how-to-spawn-a-subagent", tags: ["skill"] },
      { name: "vanilla-identity-pack", tags: ["identity"] },
    ],
    seed_quests: [
      {
        subject: "Write the one-liner",
        description: "A single sentence that explains what we sell and why anyone cares.",
        priority: "high",
      },
      {
        subject: "Ship a working demo",
        description: "Something real, clickable, shippable. No slides.",
        priority: "high",
      },
    ],
  },
  {
    slug: "studio",
    name: "Studio",
    tagline: "Content engine for a single voice.",
    description:
      "For creators, writers, and independent media. A studio threads an editor, a producer, and a distribution agent around your voice — so you write once and ship everywhere without losing the signal.",
    tags: ["creator", "content", "media"],
    seed_agents: [
      {
        name: "Studio",
        tagline: "The desk.",
        role: "Root of the creative operation.",
      },
      {
        name: "Editor",
        tagline: "Sharpens.",
        role: "Structural edits, line edits, tone. Keeps the voice.",
      },
      {
        name: "Producer",
        tagline: "Gets it made.",
        role: "Captures research, sources quotes, builds outlines.",
      },
      {
        name: "Distribution",
        tagline: "Where it lands.",
        role: "Cross-posts, schedules, measures reach.",
      },
    ],
    seed_events: [
      { pattern: "session:start", name: "Editorial check-in" },
      { pattern: "idea:stored", name: "Capture to backlog" },
    ],
    seed_ideas: [
      { name: "how-to-create-an-idea", tags: ["skill"] },
      { name: "how-to-evolve-identity", tags: ["skill"] },
      { name: "vanilla-identity-pack", tags: ["identity"] },
    ],
    seed_quests: [
      {
        subject: "Plan this week's piece",
        description: "Angle, audience, hook, length. One artifact.",
        priority: "high",
      },
    ],
  },
  {
    slug: "small-business",
    name: "Small Business",
    tagline: "A quiet operator for the family-scale company.",
    description:
      "The mom-and-pop template. Front desk that answers the website and WhatsApp, a back office that keeps docs and receipts in order, and an owner agent that watches the week. No jargon, no dashboards that demand attention.",
    tags: ["smb", "operations", "support"],
    seed_agents: [
      {
        name: "Owner",
        tagline: "Minds the shop.",
        role: "The business root. Weekly review, priorities, approvals.",
      },
      {
        name: "Front Desk",
        tagline: "Answers first.",
        role: "Website chat, WhatsApp, email triage.",
      },
      {
        name: "Office",
        tagline: "Keeps the books.",
        role: "Docs, receipts, light bookkeeping.",
      },
    ],
    seed_events: [
      { pattern: "channel:message", name: "Inbound reply" },
      { pattern: "session:start", name: "Morning rundown" },
    ],
    seed_ideas: [
      { name: "how-to-create-an-event", tags: ["skill"] },
      { name: "how-to-manage-tools", tags: ["skill"] },
      { name: "vanilla-identity-pack", tags: ["identity"] },
    ],
    seed_quests: [
      {
        subject: "Draft a friendly out-of-hours reply",
        description: "Short, warm, says when we'll get back. Signed by the business.",
        priority: "normal",
      },
    ],
  },
];

/** Look up a template in the fallback catalog by slug. */
export function findFallbackTemplate(slug: string): CompanyTemplate | undefined {
  return FALLBACK_TEMPLATES.find((t) => t.slug === slug);
}
