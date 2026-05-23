import { Link } from "react-router-dom";
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  GitBranch,
  Megaphone,
  ShieldCheck,
} from "lucide-react";

interface TrustPublicRowProps {
  basePath: string;
}

const operatingProof = [
  {
    label: "TRUST route clean",
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

const dataRoom = [
  {
    label: "Fundraising proof trail",
    detail: "Inspectable operating record for the company-runs-itself demo.",
    to: "/ideas",
    icon: FileText,
  },
  {
    label: "Launch readiness ledger",
    detail: "Open launch quests, shipped blockers, and remaining cut-line work.",
    to: "/quests",
    icon: Megaphone,
  },
  {
    label: "Operating workspace",
    detail: "Agents, ideas, quests, and decisions in one live TRUST.",
    to: "/agents",
    icon: FolderOpen,
  },
];

/**
 * Bottom half/half row for the Trust overview: Operating Proof + Data Room.
 *
 * The launch demo needs to show the company operating itself now, not an
 * empty publishing surface. The rows point at existing AEQI primitives so
 * investors can inspect the underlying work rather than a static claim.
 */
export default function TrustPublicRow({ basePath }: TrustPublicRowProps) {
  return (
    <section className="trust-public-row" aria-label="Operating proof and data room">
      <article className="trust-card trust-public-card">
        <header className="trust-public-head">
          <span className="trust-public-icon" aria-hidden>
            <Megaphone size={16} strokeWidth={1.5} />
          </span>
          <h3 className="trust-public-title">Operating proof</h3>
        </header>
        <div className="trust-public-body">
          {operatingProof.map((item) => (
            <TrustPublicItem key={item.label} item={item} basePath={basePath} />
          ))}
        </div>
      </article>

      <article className="trust-card trust-public-card">
        <header className="trust-public-head">
          <span className="trust-public-icon" aria-hidden>
            <FolderOpen size={16} strokeWidth={1.5} />
          </span>
          <h3 className="trust-public-title">Data room</h3>
        </header>
        <div className="trust-public-body">
          {dataRoom.map((item) => (
            <TrustPublicItem key={item.label} item={item} basePath={basePath} />
          ))}
        </div>
      </article>
    </section>
  );
}

interface TrustPublicItemData {
  label: string;
  detail: string;
  to: string;
  icon: typeof CheckCircle2;
}

function TrustPublicItem({ item, basePath }: { item: TrustPublicItemData; basePath: string }) {
  const Icon = item.icon;
  return (
    <Link to={`${basePath}${item.to}`} className="trust-public-item">
      <span className="trust-public-item-icon" aria-hidden>
        <Icon size={15} strokeWidth={1.5} />
      </span>
      <span className="trust-public-item-copy">
        <span className="trust-public-item-label">{item.label}</span>
        <span className="trust-public-item-detail">{item.detail}</span>
      </span>
    </Link>
  );
}
