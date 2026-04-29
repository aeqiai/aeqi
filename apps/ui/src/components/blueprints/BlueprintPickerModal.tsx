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
}

/**
 * `+ New agent` modal — wraps the shared `BlueprintLaunchPicker` in a
 * `Modal` and routes its spawn into the active entity (the picked
 * blueprint's root attaches under the entity's root agent; seeds nest
 * under that root). Single source of truth with `/start`; only the
 * destination differs.
 */
export function BlueprintPickerModal({ open, onClose, entityId }: BlueprintPickerModalProps) {
  const navigate = useNavigate();
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const handleSpawned = useCallback(async () => {
    await fetchAgents();
    onClose();
    navigate(`/${encodeURIComponent(entityId)}/agents`);
  }, [entityId, fetchAgents, navigate, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Add agents from a Blueprint">
      {open && (
        <BlueprintLaunchPicker
          mode="spawn-into-entity"
          entityId={entityId}
          onSpawnedAgent={() => void handleSpawned()}
        />
      )}
    </Modal>
  );
}
