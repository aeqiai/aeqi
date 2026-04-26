import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Input } from "./Input";
import { Badge } from "./Badge";
import { DetailField } from "./DetailField";

const meta: Meta<typeof Modal> = {
  title: "Primitives/Overlays/Modal",
  component: Modal,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

/* ── Confirmation dialog ── */

function DeleteConfirmationDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete Agent
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete Agent">
        <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: "0 0 8px" }}>
          Are you sure you want to delete{" "}
          <code
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              padding: "2px 5px",
              background: "rgba(0,0,0,0.04)",
              borderRadius: 4,
            }}
          >
            code-reviewer
          </code>
          ? This action cannot be undone.
        </p>
        <p style={{ fontSize: 12, color: "rgba(0,0,0,0.35)", margin: "0 0 24px" }}>
          3 active quests will be cancelled. 142 events will be archived.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => setOpen(false)}>
            Delete Agent
          </Button>
        </div>
      </Modal>
    </>
  );
}

export const ConfirmationDialog: Story = {
  name: "Confirmation Dialog",
  render: () => <DeleteConfirmationDemo />,
};

/* ── Form modal: Create agent ── */

function CreateAgentDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M7 1v12M1 7h12" />
        </svg>
        New Agent
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create Agent">
        <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: "0 0 16px" }}>
          Define a new autonomous agent in your runtime.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="Name" placeholder="my-agent" hint="Lowercase letters, numbers, hyphens" />
          <Input label="Model" placeholder="claude-3-opus" />
          <Input label="Identity" placeholder="You are a code review agent that..." />
        </div>
        <div style={{ marginTop: 24, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Create
          </Button>
        </div>
      </Modal>
    </>
  );
}

export const CreateAgentForm: Story = {
  name: "Create Agent Form",
  render: () => <CreateAgentDemo />,
};

/* ── Information modal: View details ── */

function AgentDetailsDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        View Agent Details
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Agent: code-reviewer">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <DetailField label="Name">
            <code
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
              }}
            >
              code-reviewer
            </code>
          </DetailField>
          <DetailField label="Status">
            <Badge variant="success" dot size="sm">
              Active
            </Badge>
          </DetailField>
          <DetailField label="Model">
            <code
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
              }}
            >
              claude-3-opus
            </code>
          </DetailField>
          <DetailField label="Active Quests">3</DetailField>
          <DetailField label="Total Events">142</DetailField>
          <DetailField label="Created">2026-04-10 09:15 UTC</DetailField>
        </div>
        <div
          style={{
            marginTop: 20,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            borderTop: "1px solid rgba(0,0,0,0.08)",
            paddingTop: 16,
          }}
        >
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Edit Agent
          </Button>
        </div>
      </Modal>
    </>
  );
}

export const InformationModal: Story = {
  name: "Information Modal",
  render: () => <AgentDetailsDemo />,
};

/* ── Quest completion modal ── */

function CompleteQuestDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Complete Quest
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Complete Quest">
        <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: "0 0 16px" }}>
          Mark <strong style={{ color: "rgba(0,0,0,0.85)" }}>Refactor auth module</strong> as
          complete?
        </p>
        <div
          style={{
            padding: "12px 14px",
            background: "rgba(0,0,0,0.015)",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 12, color: "rgba(0,0,0,0.4)", marginBottom: 4 }}>Summary</div>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,0.7)" }}>
            Extracted JWT validation into a shared middleware. Updated 12 route handlers. Added 8
            integration tests.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Mark Complete
          </Button>
        </div>
      </Modal>
    </>
  );
}

export const CompleteQuest: Story = {
  name: "Quest Completion",
  render: () => <CompleteQuestDemo />,
};
