import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  ClipboardList,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { userSessionsPath } from "@/lib/sessionViews";
import { useDaemonStore } from "@/store/daemon";
import { Textarea } from "@/components/ui";

interface CompanyOperatingConsoleProps {
  companyId: string;
  basePath: string;
}

export default function CompanyOperatingConsole({
  companyId,
  basePath,
}: CompanyOperatingConsoleProps) {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);
  const quests = useDaemonStore((s) => s.quests);
  const [brief, setBrief] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trustAgents = useMemo(
    () => agents.filter((agent) => agent.company_id === companyId || agent.id === companyId),
    [agents, companyId],
  );
  const chiefOfStaff =
    trustAgents.find((agent) => agent.name.toLowerCase() === "chief of staff") ??
    trustAgents.find((agent) => agent.status === "running" || agent.status === "active") ??
    trustAgents[0];
  const founderAssociate = trustAgents.find(
    (agent) => agent.name.toLowerCase() === "founder associate",
  );
  const trustAgentIds = useMemo(() => new Set(trustAgents.map((agent) => agent.id)), [trustAgents]);
  const trustAgentNames = useMemo(
    () => new Set(trustAgents.map((agent) => agent.name)),
    [trustAgents],
  );

  const openQuestCount = quests.filter(
    (quest) =>
      quest.status !== "done" &&
      quest.status !== "cancelled" &&
      (quest.agent_id === companyId ||
        (quest.agent_id &&
          (trustAgentIds.has(quest.agent_id) || trustAgentNames.has(quest.agent_id)))),
  ).length;

  const fallbackBrief =
    "I want to shape this company. Help me turn the current context into a concise operating brief, the next useful quests, and the first app connections to consider.";

  const handleSend = async () => {
    if (!chiefOfStaff || sending) return;
    const message = brief.trim() || fallbackBrief;
    setSending(true);
    setError(null);
    try {
      const session = await api.createSession(chiefOfStaff.id, companyId);
      const sessionId = (session.session_id as string | undefined) ?? null;
      await api.sendSessionMessage(
        {
          message,
          agent_id: chiefOfStaff.id,
          session_id: sessionId ?? undefined,
        },
        companyId,
      );
      if (sessionId) {
        navigate(sessionDeepUrlFromId(entities, companyId, chiefOfStaff.id, sessionId));
      } else {
        navigate(userSessionsPath(basePath));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not brief the operating team.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="company-operating-console"
      aria-labelledby="company-operating-console-title"
    >
      <div className="company-operating-main">
        <div className="company-operating-copy">
          <span className="company-operating-kicker">First Company</span>
          <h2 id="company-operating-console-title" className="company-operating-title">
            Tell the operating team what this company should make true.
          </h2>
          <p className="company-operating-subtitle">
            The Chief of Staff turns direction into structure. The Founder Associate turns messy
            material into briefs, open questions, and candidate quests.
          </p>
        </div>

        <div className="company-operating-composer" data-disabled={!chiefOfStaff || undefined}>
          <Textarea
            bare
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            className="company-operating-textarea"
            placeholder="Example: We are building a YouTube channel for AI founders. Create the first operating brief, content quests, and app connections."
            rows={4}
            disabled={!chiefOfStaff || sending}
          />
          <div className="company-operating-composer-footer">
            <span className="company-operating-helper">
              {chiefOfStaff
                ? `Routes to ${chiefOfStaff.name}.`
                : "Waiting for the Company blueprint operators."}
            </span>
            <button
              type="button"
              className="company-operating-send"
              onClick={handleSend}
              disabled={!chiefOfStaff || sending}
            >
              {sending ? (
                <Loader2 size={15} strokeWidth={1.8} aria-hidden className="company-spin" />
              ) : (
                <Send size={15} strokeWidth={1.8} aria-hidden />
              )}
              Brief team
            </button>
          </div>
          {error && <p className="company-operating-error">{error}</p>}
        </div>
      </div>

      <div className="company-operating-side" aria-label="Initial operating team">
        <OperatorCard
          eyebrow="Operating lead"
          title={chiefOfStaff?.name ?? "Chief of Staff"}
          body="Clarifies intent, keeps the company shape small, creates durable work, and decides what should become roles, quests, ideas, or events."
          status={chiefOfStaff?.status}
        />
        <OperatorCard
          eyebrow="Synthesis"
          title={founderAssociate?.name ?? "Founder Associate"}
          body="Turns rough notes into briefs, open questions, research plans, and draft quest candidates for approval."
          status={founderAssociate?.status}
        />
      </div>

      <div className="company-operating-actions" aria-label="Suggested next actions">
        <Link to={`${basePath}/quests`} className="company-operating-action">
          <ClipboardList size={16} strokeWidth={1.6} aria-hidden />
          <span>
            <strong>{openQuestCount} open quests</strong>
            <small>Review the current operating queue.</small>
          </span>
          <ArrowRight size={14} strokeWidth={1.7} aria-hidden />
        </Link>
        <Link to={`${basePath}/integrations`} className="company-operating-action">
          <Sparkles size={16} strokeWidth={1.6} aria-hidden />
          <span>
            <strong>Connect integrations</strong>
            <small>Give the COMPANY gateways and tools to act through.</small>
          </span>
          <ArrowRight size={14} strokeWidth={1.7} aria-hidden />
        </Link>
        <Link to={`${basePath}/roles`} className="company-operating-action">
          <BriefcaseBusiness size={16} strokeWidth={1.6} aria-hidden />
          <span>
            <strong>Inspect authority</strong>
            <small>See Director, Chief of Staff, and Founder Associate roles.</small>
          </span>
          <ArrowRight size={14} strokeWidth={1.7} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function OperatorCard({
  eyebrow,
  title,
  body,
  status,
}: {
  eyebrow: string;
  title: string;
  body: string;
  status?: string;
}) {
  const online = status === "running" || status === "active" || status === "online";
  return (
    <article className="company-operator-card">
      <span className="company-operator-eyebrow">{eyebrow}</span>
      <h3 className="company-operator-title">{title}</h3>
      <p className="company-operator-body">{body}</p>
      <span className="company-operator-status" data-online={online ? "true" : undefined}>
        <span aria-hidden />
        {status ? (online ? "Ready" : status) : "Provisioning"}
      </span>
    </article>
  );
}
