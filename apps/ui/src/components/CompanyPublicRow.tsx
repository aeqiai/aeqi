import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  GitBranch,
  Megaphone,
  Rocket,
  ShieldCheck,
} from "lucide-react";

interface CompanyPublicRowProps {
  basePath: string;
}

const operatingProof = [
  {
    label: "COMPANY route clean",
    detail: "Zero console, request, and HTTP failures on the live demo route.",
    to: "",
    icon: ShieldCheck,
  },
  {
    label: "Quest to deploy trail",
    detail: "Launch blocker moved through quest, code graph, commit, deploy, and checkpoint.",
    to: "/ideas",
    icon: GitBranch,
  },
  {
    label: "Launch smoke passed",
    detail: "Six production routes verified with seeded auth and screenshots.",
    to: "/ideas",
    icon: CheckCircle2,
  },
];

const operatingNow = [
  {
    label: "What is moving",
    detail:
      "Launch quests track the cut line, demo script, operator rehearsal, and hardening work.",
    to: "/quests",
    icon: ClipboardList,
  },
  {
    label: "What shipped",
    detail:
      "Route fixes, proof rows, launch smoke, deploys, and checkpoints are recorded as ideas.",
    to: "/ideas",
    icon: Rocket,
  },
  {
    label: "What agents learned",
    detail:
      "Durable decisions and operating traps stay in memory so the next session resumes cleanly.",
    to: "/ideas",
    icon: Activity,
  },
  {
    label: "What changed in prod",
    detail: "Production changes carry health, bundle-hash, screenshot, and smoke evidence.",
    to: "/ideas",
    icon: CheckCircle2,
  },
];

const dataRoom = [
  {
    label: "Fundraising proof trail",
    detail: "Inspectable operating record for the company-runs-itself demo.",
    to: "/ideas",
    icon: FileText,
  },
  {
    label: "Investor walkthrough",
    detail: "Five-minute script from launch to live proof to checkpoint.",
    to: "/ideas",
    icon: Rocket,
  },
  {
    label: "Launch readiness ledger",
    detail: "Open launch quests, shipped blockers, and remaining cut-line work.",
    to: "/quests",
    icon: Megaphone,
  },
  {
    label: "Operating workspace",
    detail: "Agents, ideas, quests, and decisions in one live COMPANY.",
    to: "/agents",
    icon: FolderOpen,
  },
];

/**
 * Bottom proof row for the Company overview.
 *
 * The launch demo needs to show the company operating itself now, not an
 * empty publishing surface. The rows point at existing AEQI primitives so
 * investors can inspect the underlying work rather than a static claim.
 */
export default function CompanyPublicRow({ basePath }: CompanyPublicRowProps) {
  return (
    <section className="company-public-row" aria-label="Operating dashboard, proof, and data room">
      <article className="company-card company-public-card company-public-card--wide">
        <header className="company-public-head">
          <span className="company-public-icon" aria-hidden>
            <Activity size={16} strokeWidth={1.5} />
          </span>
          <h3 className="company-public-title">Operating now</h3>
        </header>
        <div className="company-public-body company-public-body--grid">
          {operatingNow.map((item) => (
            <CompanyPublicItem key={item.label} item={item} basePath={basePath} />
          ))}
        </div>
      </article>

      <article className="company-card company-public-card">
        <header className="company-public-head">
          <span className="company-public-icon" aria-hidden>
            <Megaphone size={16} strokeWidth={1.5} />
          </span>
          <h3 className="company-public-title">Operating proof</h3>
        </header>
        <div className="company-public-body">
          {operatingProof.map((item) => (
            <CompanyPublicItem key={item.label} item={item} basePath={basePath} />
          ))}
        </div>
      </article>

      <article className="company-card company-public-card">
        <header className="company-public-head">
          <span className="company-public-icon" aria-hidden>
            <FolderOpen size={16} strokeWidth={1.5} />
          </span>
          <h3 className="company-public-title">Data room</h3>
        </header>
        <div className="company-public-body">
          {dataRoom.map((item) => (
            <CompanyPublicItem key={item.label} item={item} basePath={basePath} />
          ))}
        </div>
      </article>
    </section>
  );
}

interface CompanyPublicItemData {
  label: string;
  detail: string;
  to: string;
  icon: typeof CheckCircle2;
}

function CompanyPublicItem({ item, basePath }: { item: CompanyPublicItemData; basePath: string }) {
  const Icon = item.icon;
  return (
    <Link to={`${basePath}${item.to}`} className="company-public-item">
      <span className="company-public-item-icon" aria-hidden>
        <Icon size={15} strokeWidth={1.5} />
      </span>
      <span className="company-public-item-copy">
        <span className="company-public-item-label">{item.label}</span>
        <span className="company-public-item-detail">{item.detail}</span>
      </span>
    </Link>
  );
}
