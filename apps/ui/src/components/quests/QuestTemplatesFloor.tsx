import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import type { SingleBlueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { Button, Loading } from "../ui";

export default function QuestTemplatesFloor({
  companyId,
  onCreated,
}: {
  companyId: string;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [blueprints, setBlueprints] = useState<SingleBlueprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingTemplateId, setImportingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getBlueprints()
      .then(async (resp) => {
        if (cancelled) return;
        const incoming = (resp.blueprints ?? []).filter(isSingleBlueprint);
        const detailResults = await Promise.allSettled(
          incoming.map((template) => api.getBlueprint(blueprintId(template))),
        );
        if (cancelled) return;
        const hydrated = detailResults.map((result, index) =>
          result.status === "fulfilled" && isSingleBlueprint(result.value.blueprint)
            ? result.value.blueprint
            : incoming[index],
        );
        setBlueprints(hydrated);
      })
      .catch((e) => {
        if (cancelled) return;
        setBlueprints([]);
        setError(e instanceof Error ? e.message : "Could not load quest templates.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const templates = useMemo(
    () =>
      blueprints
        .filter((template) => (template.seed_quests?.length ?? 0) > 0)
        .sort((a, b) => (b.seed_quests?.length ?? 0) - (a.seed_quests?.length ?? 0)),
    [blueprints],
  );

  const browseQuestTemplates = useCallback(() => {
    navigate(`/templates/companies?import_into=${encodeURIComponent(companyId)}&q=quest`);
  }, [companyId, navigate]);

  const importQuestTemplate = useCallback(
    async (template: SingleBlueprint) => {
      const id = blueprintId(template);
      if (importingTemplateId) return;
      setImportingTemplateId(id);
      setError(null);
      try {
        await api.spawnBlueprintIntoEntity({
          blueprint: id,
          company_id: companyId,
          parts: ["quests"],
        });
        onCreated();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not import quest template.");
      } finally {
        setImportingTemplateId(null);
      }
    },
    [companyId, importingTemplateId, onCreated],
  );

  const visible = templates.slice(0, 3);

  return (
    <section className="quest-templates-floor" aria-label="Quest templates">
      <header className="quest-templates-floor-head">
        <div className="quest-templates-floor-title-row">
          <h2 className="quest-templates-floor-title">Quest templates</h2>
          <span className="quest-templates-floor-count" aria-hidden>
            {templates.length}
          </span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="quest-templates-floor-browse"
          onClick={browseQuestTemplates}
          aria-label="Browse quest templates"
        >
          Browse templates
        </Button>
      </header>

      {loading ? (
        <div className="quest-templates-floor-state">
          <Loading size="sm" /> Loading quest templates...
        </div>
      ) : error ? (
        <div className="quest-templates-floor-state" role="status">
          Quest templates are unavailable right now.
        </div>
      ) : visible.length === 0 ? (
        <div className="quest-templates-floor-state" role="status">
          No quest templates are published yet.
        </div>
      ) : (
        <div className="quest-templates-floor-grid">
          {visible.map((template) => {
            const id = blueprintId(template);
            const questCount = template.seed_quests?.length ?? 0;
            const firstQuest = template.seed_quests?.[0]?.subject;
            const busy = importingTemplateId === id;
            return (
              <button
                key={id}
                type="button"
                className="quest-templates-floor-card"
                onClick={() => void importQuestTemplate(template)}
                disabled={Boolean(importingTemplateId)}
                aria-label={`Import ${template.name} quest template`}
              >
                <h3 className="quest-templates-floor-card-title">{template.name}</h3>
                <p className="quest-templates-floor-card-desc">
                  {firstQuest ?? template.tagline ?? "Template-backed quest set."}
                </p>
                <p className="quest-templates-floor-card-meta">
                  {questCount} {questCount === 1 ? "quest" : "quests"}
                </p>
                <span className="quest-templates-floor-card-cta" aria-hidden>
                  {busy ? "Importing" : "Import quests"}
                  {!busy && <ArrowRight size={12} strokeWidth={1.8} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
