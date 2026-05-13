import { Button, EmptyState } from "../ui";

export default function AgentsEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState
      eyebrow="Agents"
      title="No agents in this company yet."
      description="Pick a Blueprint and its agents join the tree."
      action={
        <Button variant="primary" onClick={onNew}>
          New agent
        </Button>
      }
    />
  );
}
