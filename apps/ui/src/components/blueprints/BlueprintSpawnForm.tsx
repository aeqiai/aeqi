import { Button, Input, Spinner } from "@/components/ui";
import type { CompanyTemplate } from "@/lib/types";

interface BlueprintSpawnFormProps {
  template: CompanyTemplate;
  companyName: string;
  onCompanyNameChange: (next: string) => void;
  onSpawn: () => void;
  submitting: boolean;
  submitError: string | null;
  isAuthed: boolean;
  importMode: boolean;
  importTargetName: string | null;
}

export function BlueprintSpawnForm({
  template,
  companyName,
  onCompanyNameChange,
  onSpawn,
  submitting,
  submitError,
  isAuthed,
  importMode,
  importTargetName,
}: BlueprintSpawnFormProps) {
  return (
    <form
      className="bp-detail-spawn"
      onSubmit={(e) => {
        e.preventDefault();
        if (importMode) return;
        onSpawn();
      }}
    >
      {importMode ? (
        <>
          <span className="bp-detail-spawn-label">
            Add to {importTargetName || "selected agent"}
          </span>
          <Button type="button" variant="primary" disabled>
            Coming soon
          </Button>
          <p className="bp-detail-spawn-hint">
            The merge endpoint isn&rsquo;t wired yet — picking a blueprint here will graft its seed
            agents, ideas, events, and quests onto the target&rsquo;s tree once the server route
            ships.
          </p>
        </>
      ) : (
        <>
          <Input
            id="bp-company-name"
            label="Company name"
            type="text"
            value={companyName}
            onChange={(e) => onCompanyNameChange(e.target.value)}
            placeholder={template.name}
            maxLength={48}
            disabled={submitting}
            autoComplete="off"
            error={submitError ?? undefined}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Spinner size="sm" />
                Spawning…
              </>
            ) : isAuthed ? (
              <>Start this Company</>
            ) : (
              <>Sign Up to Start</>
            )}
          </Button>
          {!isAuthed && (
            <p className="bp-detail-spawn-hint">
              Free trial. One company on us — pick any blueprint to begin.
            </p>
          )}
        </>
      )}
    </form>
  );
}
