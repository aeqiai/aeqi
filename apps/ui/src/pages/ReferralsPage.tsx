import { ArrowRight, Mail, Share2, Users } from "lucide-react";
import { Link } from "react-router-dom";

const INVITE_HREF =
  "mailto:?subject=Build%20with%20aeqi&body=I%20think%20you%20should%20try%20aeqi:%20https%3A%2F%2Fapp.aeqi.ai%2Flaunch";

const PLAYBOOK = [
  {
    title: "Invite a serious operator",
    copy: "Start with founders, builders, and company operators who already feel the pain of context, delegation, and operating memory.",
  },
  {
    title: "Point them at a template",
    copy: "Templates give the first session a concrete shape, so the referral is not abstract product curiosity.",
  },
  {
    title: "Help them launch",
    copy: "The loop compounds when invited users create a COMPANY, seed agents, and bring their own collaborators onto the platform.",
  },
];

const CHANNELS = ["Founder group", "Operator community", "Investor update", "Builder friend"];

export default function ReferralsPage() {
  return (
    <main className="referrals-page" aria-labelledby="referrals-title">
      <section className="referrals-hero">
        <div className="referrals-hero-copy">
          <span className="referrals-kicker">
            <Share2 size={15} strokeWidth={1.7} aria-hidden="true" />
            Referrals
          </span>
          <h1 id="referrals-title">Bring the right operators into aeqi.</h1>
          <p>
            Referrals are the growth loop for the company OS: invite people who can launch a
            COMPANY, work with agents, and bring the next serious operator with them.
          </p>
        </div>
        <div className="referrals-actions" aria-label="Referral actions">
          <div className="referrals-actions-copy">
            <h2>Invite to aeqi</h2>
            <p>Send people to the platform, then give them a launch path.</p>
          </div>
          <a className="referrals-primary-action" href={INVITE_HREF}>
            <Mail size={16} strokeWidth={1.8} aria-hidden="true" />
            Invite someone
          </a>
          <Link className="referrals-secondary-action" to="/templates">
            Browse templates
            <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="referrals-playbook" aria-label="Referral playbook">
        <header className="referrals-section-head">
          <h2>Referral playbook</h2>
          <p>Keep every invite tied to a real launch path.</p>
        </header>
        <div className="referrals-steps">
          {PLAYBOOK.map((step, index) => (
            <article key={step.title} className="referrals-step">
              <span className="referrals-step-index">{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="referrals-channels" aria-label="Referral channels">
        <header className="referrals-section-head">
          <h2>Who to invite first</h2>
          <p>Prioritize people who can create signal on day one.</p>
        </header>
        <div className="referrals-channel-grid">
          {CHANNELS.map((channel) => (
            <article key={channel} className="referrals-channel-card">
              <Users size={15} strokeWidth={1.7} aria-hidden="true" />
              <span>{channel}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
