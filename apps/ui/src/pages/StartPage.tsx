import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { BlueprintLaunchPicker } from "@/components/blueprints/BlueprintLaunchPicker";
import { Textarea, Button } from "@/components/ui";
import { Events, useTrack } from "@/lib/analytics";

const START_PROMPTS = [
  "A company that ships AI agents for customer support and ops",
  "A crypto-native studio with treasury, vesting, and governance",
  "A small founder-led company with roles, hiring, and a clear roadmap",
];

/**
 * `/start` is the company studio. It turns a short brief into a concrete
 * setup path: user intent first, blueprint selection second, then the
 * setup wizard handles the specific company structure.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const track = useTrack();

  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);

  const isAuthed = authMode === "none" || !!token;
  const [brief, setBrief] = useState("");

  useEffect(() => {
    document.title = "Start a company · aeqi";
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      navigate(`/signup?next=${encodeURIComponent("/start")}`, { replace: true });
      return;
    }
    track(Events.CompanyCreateStart, { surface: "start" });
  }, [isAuthed, navigate, track]);

  const launchQuery = useMemo(() => {
    const trimmed = brief.trim();
    return trimmed ? `?brief=${encodeURIComponent(trimmed)}` : "";
  }, [brief]);

  if (!isAuthed) return null;

  return (
    <div className="start-page">
      <header className="start-head start-head--studio">
        <p className="start-eyebrow">Company studio</p>
        <h1 className="page-title">What are you building?</h1>
        <p className="start-sub">
          Write a short brief. AEQI will shape the company structure, then you can pick a blueprint
          and finish the setup.
        </p>
      </header>

      <section className="start-brief-panel" aria-label="Company brief">
        <Textarea
          bare
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Tell AEQI what this company should do, who it serves, and what makes it different."
          rows={7}
          className="start-brief-input"
        />
        <div className="start-brief-actions">
          {START_PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setBrief(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      </section>

      <section className="start-library-panel" aria-label="Blueprint library">
        <div className="start-section-head">
          <p className="start-section-kicker">Blueprints</p>
          <h2 className="start-section-title">Pick a starting pattern</h2>
          <p className="start-section-sub">
            Blank, recommended, or browse all. Your brief carries into the setup wizard.
          </p>
        </div>
        <BlueprintLaunchPicker mode="spawn-company" launchQuery={launchQuery} />
      </section>
    </div>
  );
}
