import type { Meta, StoryObj } from "@storybook/react";
import { Accordion } from "./Accordion";

const meta: Meta<typeof Accordion> = {
  title: "Primitives/Containers/Accordion",
  component: Accordion,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Accordion>;

/* ── Default: Three items, all closed ── */

export const Default: Story = {
  name: "Default",
  render: () => (
    <Accordion>
      <Accordion.Item question="What is aeqi?">
        aeqi is the company OS for the agent economy. Define a mission, staff positions with agents,
        and they coordinate execution under your direction. Source-available, self-hostable, and
        hosted at app.aeqi.ai.
      </Accordion.Item>
      <Accordion.Item question="How is this different from a framework?">
        Frameworks are libraries you import into your own app. aeqi is a runtime you deploy on. You
        get agents, an event log, quest execution, and ownership primitives out of the box — not
        building blocks to assemble them yourself.
      </Accordion.Item>
      <Accordion.Item question="Which models does aeqi support?">
        Model-agnostic. Anthropic, OpenAI, any provider via OpenRouter, and local models via Ollama.
        Bring your own API key; you pay the provider directly.
      </Accordion.Item>
    </Accordion>
  ),
};

/* ── With first item open by default ── */

export const WithDefaultOpen: Story = {
  name: "With Default Open",
  render: () => (
    <Accordion>
      <Accordion.Item question="How do I start a company?" defaultOpen={true}>
        Start with a mission. Create a company workspace. Add agents to fill the positions you need.
        Capture ideas, open quests, and the company starts operating before you've hired a single
        human.
      </Accordion.Item>
      <Accordion.Item question="What kinds of work fit?">
        Work that can be described, executed, reviewed, and improved over time. Software, research,
        content, marketing, support, operations, finance workflows, and founder assistance are
        natural starting points.
      </Accordion.Item>
      <Accordion.Item question="Do I need to be technical?">
        No. You define what the company should do; agents figure out how. The runtime handles
        orchestration, isolation, and state.
      </Accordion.Item>
    </Accordion>
  ),
};

/* ── Rich content: Answer with markup, lists, links ── */

export const RichContent: Story = {
  name: "Rich Content",
  render: () => (
    <Accordion>
      <Accordion.Item question="How much does aeqi cost?">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p>
            <strong>Free</strong> to start (500k tokens, no credit card).
          </p>
          <ul
            style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}
          >
            <li>
              <strong>Launch</strong> — $39/month per company. 8M tokens included, managed hosting.
            </li>
            <li>
              <strong>Scale</strong> — $119/month per company. 32M tokens, 4× resources, priority
              support, API and MCP access.
            </li>
          </ul>
          <p>
            Annual billing saves ~14%. Token overage is billed at provider cost. Bring your own LLM
            key to bypass aeqi's token billing entirely.
          </p>
        </div>
      </Accordion.Item>
      <Accordion.Item question="Are humans still in control?">
        <p>
          Yes. Humans set <strong>mission</strong>, <strong>strategy</strong>,{" "}
          <strong>judgment</strong>,<strong> approval boundaries</strong>, and{" "}
          <strong>accountability</strong>. Agents coordinate execution and escalate when human
          decisions are needed.
        </p>
      </Accordion.Item>
      <Accordion.Item question="Where does state live?">
        <p>
          Everything is an append-only event log plus a handful of derived tables. The log is the
          audit trail; it's what agents reason over and what you read when something goes wrong.
        </p>
        <p style={{ marginTop: 12, marginBottom: 0 }}>
          This design ensures complete observability and recovery at every stage of execution.
        </p>
      </Accordion.Item>
    </Accordion>
  ),
};
