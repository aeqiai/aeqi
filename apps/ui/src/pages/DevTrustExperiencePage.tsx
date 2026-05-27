import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Wordmark from "@/components/Wordmark";
import Composer from "@/components/composer/Composer";
import { Badge, Button } from "@/components/ui";
import "@/styles/dev-trust-experience.css";

const PROMPTS = [
  "A research studio that turns one technical bet into a shipped product every month.",
  "A holding company for tools, media, and experiments that need disciplined operators.",
  "A founder office that keeps strategy, hiring, customer proof, and shipping moving.",
];

const BLUEPRINT_RECEIPT = [
  {
    label: "Chief of Staff",
    value: "Owns the operating loop and asks the next good question.",
  },
  {
    label: "Founder Associate",
    value: "Turns rough direction into briefs, research, and draft quests.",
  },
  {
    label: "Ideas",
    value: "Seeds durable memory for working style, company shape, and capture rules.",
  },
  {
    label: "Quests",
    value: "Creates the first setup board from Director brief to role map.",
  },
  {
    label: "Events",
    value: "Installs lifecycle context and a weekly review routine.",
  },
  {
    label: "Website",
    value: "Keeps a public shell ready when the company is ready to show itself.",
  },
];

export default function DevTrustExperiencePage() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState("");
  const [assembled, setAssembled] = useState(false);

  const trimmedBrief = brief.trim();
  const directorBrief = useMemo(() => {
    if (assembled && trimmedBrief) return trimmedBrief;
    return "One rough sentence becomes agents, memory, quests, events, and the first operating cadence.";
  }, [assembled, trimmedBrief]);

  const handleSend = () => {
    if (!trimmedBrief) return;
    setAssembled(true);
  };

  return (
    <main className="dev-trust-page">
      <header className="dev-trust-topbar" aria-label="Experiment navigation">
        <Wordmark size={18} />
        <Button variant="secondary" size="sm" onClick={() => navigate("/launch/aeqi")}>
          Current Launch
        </Button>
      </header>

      <section className="dev-trust-stage" aria-labelledby="dev-trust-title">
        <div className="dev-trust-grid">
          <aside
            className="dev-trust-panel dev-trust-panel--left"
            aria-label="First Company blueprint"
          >
            <div className="dev-trust-panel-head">
              <Badge variant="accent" size="sm" dot>
                First Company
              </Badge>
              <span className="dev-trust-panel-meta">Blueprint</span>
            </div>
            <p className="dev-trust-panel-copy">
              A neutral company substrate: one Chief of Staff, one Founder Associate, durable
              memory, scoped quests, lifecycle context, and a review rhythm.
            </p>
          </aside>

          <div className="dev-trust-core">
            <div className="dev-trust-title-block">
              <Badge variant={assembled ? "success" : "neutral"} size="sm" dot>
                {assembled ? "Draft assembled" : "New TRUST"}
              </Badge>
              <h1 id="dev-trust-title">
                Describe the company. aeqi assembles the operating system.
              </h1>
              <p>
                Start messy. First Company turns the first sentence into the company surface:
                agents, ideas, quests, events, and a working cadence.
              </p>
            </div>

            <div className="dev-trust-composer-wrap">
              <Composer
                className="dev-trust-composer"
                variant="card"
                value={brief}
                onChange={(next) => {
                  setBrief(next);
                  if (assembled) setAssembled(false);
                }}
                onSend={handleSend}
                placeholder="Build a company that..."
                sendLabel="Assemble TRUST"
                showKbdRibbon={false}
              />
            </div>

            <div className="dev-trust-prompts" aria-label="Example company directions">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="dev-trust-prompt"
                  onClick={() => {
                    setBrief(prompt);
                    setAssembled(false);
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="dev-trust-actions">
              <Button
                variant="primary"
                size="lg"
                onClick={() => navigate("/launch/aeqi")}
                trailingIcon={<ArrowRight size={16} strokeWidth={1.6} />}
              >
                Continue with First Company
              </Button>
              <span className="dev-trust-actions-note">
                Draft first. Launch when it feels right.
              </span>
            </div>
          </div>

          <aside className="dev-trust-panel dev-trust-panel--right" aria-label="Assembly receipt">
            <div className="dev-trust-panel-head">
              <span className="dev-trust-panel-meta">Director brief</span>
              <CheckCircle2 size={14} strokeWidth={1.7} aria-hidden="true" />
            </div>
            <p className="dev-trust-brief">{directorBrief}</p>

            <div className="dev-trust-receipt" aria-label="First Company components">
              {BLUEPRINT_RECEIPT.map((item) => (
                <div className="dev-trust-receipt-row" key={item.label}>
                  <span>{item.label}</span>
                  <p>{item.value}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
