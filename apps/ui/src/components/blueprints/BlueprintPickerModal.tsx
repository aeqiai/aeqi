import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { Modal } from "@/components/ui";
import { BlueprintLaunchPicker } from "@/components/blueprints/BlueprintLaunchPicker";

interface BlueprintPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Host entity that the picked Blueprint will be spawned into. */
  entityId: string;
  /**
   * Which seed parts to materialize. Omit (default) for the full
   * `+ New agent` flow that pulls in all four primitives. Pass
   * `["ideas"]` / `["quests"]` for the Import-from-blueprint flow on
   * the Ideas / Quests tabs — only the named seed blocks land.
   */
  parts?: string[];
  /**
   * Optional — fired after a successful spawn so the host page can
   * refresh just the affected primitive (ideas list, quests list)
   * instead of the default agent-tree navigate. When provided, the
   * modal does NOT navigate.
   */
  onSpawned?: () => void;
  /** Modal title — defaults to "Add agents from a Blueprint". */
  title?: string;
}

/**
 * `+ New agent` modal — wraps the shared `BlueprintLaunchPicker` in a
 * `Modal` and routes its spawn into the active entity (the picked
 * blueprint's root attaches under the entity's root agent; seeds nest
 * under that root). Single source of truth with `/start`; only the
 * destination differs.
 *
 * Reused by Ideas / Quests Import-from-blueprint via the `parts` +
 * `onSpawned` props — same picker, narrower scope.
 */
export function BlueprintPickerModal({
  open,
  onClose,
  entityId,
  parts,
  onSpawned,
  title,
}: BlueprintPickerModalProps) {
  const navigate = useNavigate();
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const handleSpawned = useCallback(async () => {
    await fetchAgents();
    onClose();
    if (onSpawned) {
      onSpawned();
    } else {
      navigate(`/c/${encodeURIComponent(entityId)}/agents`);
    }
  }, [entityId, fetchAgents, navigate, onClose, onSpawned]);

  return (
    <Modal open={open} onClose={onClose} title={title ?? "Add agents from a Blueprint"}>
      {open && (
        <BlueprintLaunchPicker
          mode="spawn-into-entity"
          entityId={entityId}
          parts={parts}
          onSpawnedAgent={() => void handleSpawned()}
        />
      )}
    </Modal>
  );
}
