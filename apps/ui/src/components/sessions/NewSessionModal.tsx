import { Button, Modal, Select } from "@/components/ui";

type AgentOption = {
  value: string;
  label: string;
};

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  agentOptions: AgentOption[];
  agentId: string;
  onAgentChange: (agentId: string) => void;
  creating: boolean;
  error: string | null;
}

export default function NewSessionModal({
  open,
  onClose,
  onSubmit,
  agentOptions,
  agentId,
  onAgentChange,
  creating,
  error,
}: NewSessionModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New session"
      description="Choose the agent this conversation should start with."
      className="aeqi-form-modal"
      footer={
        <div className="aeqi-form-modal__footer">
          {error && (
            <div className="aeqi-form-modal__error" role="alert">
              {error}
            </div>
          )}
          <div className="aeqi-form-modal__actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-session-form"
              variant="primary"
              size="sm"
              loading={creating}
              disabled={!agentId}
            >
              Start session
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="new-session-form"
        className="aeqi-form-modal__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="company-sessions-modal-field" htmlFor="new-session-agent">
          <span>Agent</span>
          <Select
            id="new-session-agent"
            options={agentOptions}
            value={agentId}
            onChange={onAgentChange}
            placeholder="Select agent"
            disabled={creating || agentOptions.length === 0}
            fullWidth
          />
        </label>
      </form>
    </Modal>
  );
}
