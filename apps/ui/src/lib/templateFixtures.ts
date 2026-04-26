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
/** Slug of the canonical default Blueprint. Mirrors the runtime's
 *  `templates::DEFAULT_BLUEPRINT_SLUG` and the `[blueprints] default`
 *  config — sourced here so unauthed/offline visitors of `/start` see
 *  the same default the server would resolve. */
export const DEFAULT_TEMPLATE_SLUG = "aeqi";

export const FALLBACK_TEMPLATES: CompanyTemplate[] = [
  {
    slug: "aeqi",
    name: "aeqi",
    tagline: "A single agent. Yours. Start anywhere.",
    description:
      "The minimal company — one root agent, no scaffolding, no opinions. Pick this if you want to shape your company by hand: name it, talk to it, add agents/ideas/events/quests as you go.",
    tags: ["minimal", "default"],
    seed_agents: [],
    seed_events: [{ pattern: "session:start", name: "Session bootstrap" }],
    seed_ideas: [{ name: "Operating principles", tags: ["identity", "priorities"] }],
    seed_quests: [],
    root: {
      name: "aeqi",
      model: "anthropic/claude-sonnet-4.6",
      color: "#0a0a0b",
    },
  },
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
  {
    slug: "tech-studio",
    name: "Tech Studio",
    tagline: "A small engineering team that ships software, not slides.",
    description:
      "A software studio with a Tech Lead (root), two senior engineers, a designer-engineer, and an operator who keeps environments and releases steady.",
    tags: ["software", "engineering", "studio"],
    seed_agents: [
      { name: "Tech Lead", role: "Sets technical direction." },
      { name: "Senior Engineer (Backend)", role: "Backend implementation." },
      { name: "Senior Engineer (Frontend)", role: "Frontend implementation." },
      { name: "Designer-Engineer", role: "Design system + components." },
      { name: "Operator", role: "CI, deploys, infra health." },
    ],
    seed_events: [
      { pattern: "session:start", name: "Sprint bootstrap" },
      { pattern: "schedule:0 9 * * 1", name: "Weekly release cadence" },
    ],
    seed_ideas: [
      { name: "Engineering principles", tags: ["identity", "evergreen"] },
      { name: "Release cadence", tags: ["cadence"] },
      { name: "Architecture defaults", tags: ["architecture"] },
    ],
    seed_quests: [
      { subject: "Pick the next product to spin up", priority: "high" },
      { subject: "Stand up the studio's release pipeline", priority: "high" },
    ],
  },
  {
    slug: "solo-creator",
    name: "Solo Creator",
    tagline: "One creator. One voice. A producer and a community lead doing the heavy lifting.",
    description:
      "A creator-led company built for a single talent: video, audio, writing, or all three.",
    tags: ["creator", "content", "media"],
    seed_agents: [
      { name: "Creator", role: "Voice and direction." },
      { name: "Producer", role: "Turns ideas into shipped pieces." },
      { name: "Community Lead", role: "Audience care + signal triage." },
    ],
    seed_events: [
      { pattern: "session:start", name: "Pipeline check-in" },
      { pattern: "schedule:0 16 * * 5", name: "Weekly audience digest" },
    ],
    seed_ideas: [
      { name: "Creator voice", tags: ["voice", "identity"] },
      { name: "Pipeline rhythm", tags: ["cadence"] },
      { name: "Reply policy", tags: ["voice"] },
    ],
    seed_quests: [
      { subject: "Pick this week's piece", priority: "high" },
      { subject: "Run the first audience-signal digest", priority: "normal" },
    ],
  },
  {
    slug: "agency",
    name: "Services Agency",
    tagline: "An expert services firm that ships engagements, not slide decks.",
    description:
      "A services agency built for paid client engagements: a Managing Partner (root), two senior consultants, and a Producer who runs delivery.",
    tags: ["services", "agency", "consulting"],
    seed_agents: [
      { name: "Managing Partner", role: "Wins work, owns positioning." },
      { name: "Senior Consultant (Strategy)", role: "Reframes problems, produces memos." },
      { name: "Senior Consultant (Delivery)", role: "Implements with the client." },
      { name: "Producer", role: "Engagement calendar + status notes." },
    ],
    seed_events: [
      { pattern: "session:start", name: "Engagement bootstrap" },
      { pattern: "schedule:0 16 * * 5", name: "Friday status" },
    ],
    seed_ideas: [
      { name: "Agency positioning", tags: ["identity", "stance"] },
      { name: "Engagement structure", tags: ["playbook"] },
      { name: "Pricing rules", tags: ["stance"] },
    ],
    seed_quests: [
      { subject: "Draft the first proposal", priority: "high" },
      { subject: "Stand up the engagement calendar", priority: "normal" },
    ],
  },
  {
    slug: "personal-os",
    name: "Personal OS",
    tagline: "One agent that runs your life like a chief of staff who actually knows you.",
    description:
      "A single-agent operating layer for one person. Holds your calendar, inbox, tasks, and durable notes.",
    tags: ["personal", "assistant", "daily"],
    seed_agents: [{ name: "Concierge", role: "Your chief of staff." }],
    seed_events: [
      { pattern: "session:start", name: "Standing rules bootstrap" },
      { pattern: "schedule:30 7 * * *", name: "Morning brief" },
      { pattern: "schedule:0 17 * * 0", name: "Weekly review" },
    ],
    seed_ideas: [
      { name: "Operator's standing rules", tags: ["rules", "identity"] },
      { name: "Communication preferences", tags: ["preferences"] },
      { name: "Daily-brief format", tags: ["daily-brief"] },
    ],
    seed_quests: [
      { subject: "Run the first morning brief", priority: "high" },
      { subject: "Capture the operator's current priorities", priority: "high" },
    ],
  },
  {
    slug: "community",
    name: "Community Platform",
    tagline: "An always-on operations team for a Discord, Slack, or Telegram community.",
    description:
      "A community-operations company built around a Lead (root), a Moderator who keeps tone and norms intact, and a Curator who lifts the best signal up where members can find it.",
    tags: ["community", "operations"],
    seed_agents: [
      { name: "Community Lead", role: "Sets and protects the culture." },
      { name: "Moderator", role: "Enforces norms, acts on violations." },
      { name: "Curator", role: "Surfaces the best signal daily." },
    ],
    seed_events: [
      { pattern: "session:start", name: "Norms refresh" },
      { pattern: "schedule:0 19 * * *", name: "Daily curation" },
    ],
    seed_ideas: [
      { name: "Community norms", tags: ["norm", "identity"] },
      { name: "Moderation philosophy", tags: ["norm"] },
      { name: "Daily curation rules", tags: ["procedure"] },
    ],
    seed_quests: [
      { subject: "Welcome the last 14 days of new members", priority: "high" },
      { subject: "Run the first daily curation", priority: "normal" },
    ],
  },
];

/** Look up a template in the fallback catalog by slug. */
export function findFallbackTemplate(slug: string): CompanyTemplate | undefined {
  return FALLBACK_TEMPLATES.find((t) => t.slug === slug);
}
