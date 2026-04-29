import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { CompanyTemplate } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, Modal, Spinner } from "@/components/ui";
import "@/styles/blueprints-store.css";

interface BlueprintPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Host entity that the picked Blueprint will be spawned into. */
  entityId: string;
}

/**
 * Compact in-modal Blueprint catalog. Spawning a Blueprint here imports it
 * INTO the active entity (the picked blueprint's root attaches under the
 * entity's root agent; seeds nest under that root). Same blueprint JSON as
 * `/start`; the destination determines behavior.
 *
 * Replaces the legacy `/new?parent=…` full-page form.
 */
export function BlueprintPickerModal({ open, onClose, entityId }: BlueprintPickerModalProps) {
  const navigate = useNavigate();
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const [blueprints, setBlueprints] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [spawning, setSpawning] = useState<string | null>(null);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  // Reset transient state when the modal closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSpawning(null);
      setSpawnError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getBlueprints()
      .then((resp) => {
        if (cancelled) return;
        setBlueprints(resp.blueprints ?? []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not reach the Blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blueprints;
    return blueprints.filter((t) =>
      [t.name, t.tagline, t.description].some((s) => (s || "").toLowerCase().includes(q)),
    );
  }, [blueprints, query]);

  const handleSpawn = useCallback(
    async (slug: string) => {
      setSpawning(slug);
      setSpawnError(null);
      try {
        await api.spawnBlueprintIntoEntity({ blueprint: slug, entity_id: entityId });
        await fetchAgents();
        onClose();
        navigate(`/${encodeURIComponent(entityId)}/agents`);
      } catch (e) {
        setSpawnError(e instanceof Error ? e.message : "Failed to spawn agents.");
        setSpawning(null);
      }
    },
    [entityId, fetchAgents, navigate, onClose],
  );

  return (
    <Modal open={open} onClose={onClose} title="Add agents from a Blueprint">
      <div className="bp-picker">
        <input
          type="search"
          className="bp-picker-search"
          placeholder="Search Blueprints"
          aria-label="Search Blueprints"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {error && (
          <p className="bp-picker-error" role="alert">
            {error}
          </p>
        )}

        {spawnError && (
          <p className="bp-picker-error" role="alert">
            {spawnError}
          </p>
        )}

        {loading ? (
          <div className="bp-picker-status" role="status">
            <Spinner size="sm" /> Loading Blueprints…
          </div>
        ) : filtered.length === 0 ? (
          <p className="bp-picker-status">No Blueprints match.</p>
        ) : (
          <ul className="bp-picker-list" role="list">
            {filtered.map((t) => {
              const isBusy = spawning === t.slug;
              const disabled = spawning !== null;
              return (
                <li key={t.slug} className="bp-picker-row">
                  <div className="bp-picker-row-body">
                    <span className="bp-picker-row-name">{t.name}</span>
                    {t.tagline && <span className="bp-picker-row-tagline">{t.tagline}</span>}
                    <span className="bp-picker-row-counts">
                      a{1 + (t.seed_agents?.length ?? 0)} · i{t.seed_ideas?.length ?? 0} · e
                      {t.seed_events?.length ?? 0} · q{t.seed_quests?.length ?? 0}
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleSpawn(t.slug)}
                    disabled={disabled}
                  >
                    {isBusy ? "Spawning…" : "Spawn"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
