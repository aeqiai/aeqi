import { Button, EmptyState } from "../ui";

export default function AgentsEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="agents-empty">
      <EmptyState
        title="Agents make this company act."
        description="An agent is a role with a charter, a model, and the tools to do its job. Pick a template to seed a working team in one step."
        action={
          <Button variant="primary" onClick={onNew}>
            Pick a template
          </Button>
        }
      />
    </div>
  );
}
