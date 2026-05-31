import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, FileText, Globe, Plus, Rocket, Share2, Users } from "lucide-react";
import { LEARN_POSTS } from "./startPageLearnPosts";
import "@/styles/roles.css";

export default function StartPage() {
  const currentDateTime = useCurrentDateTime();

  return (
    <div className="home-page">
      <header className="home-hero home-hero--global" aria-label="aeqi home">
        <img src="/welcome/start-hero.png" alt="" className="home-hero-image" aria-hidden="true" />
        <div className="home-hero-overlay">
          <div className="home-hero-identity">
            <div className="home-hero-text">
              <p className="home-hero-eyebrow">The company OS</p>
              <h1 className="home-hero-title">Welcome</h1>
              <span className="home-hero-profile-copy">
                <span className="home-hero-subtitle">{currentDateTime}</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="home-body">
        <section className="home-row-promos" aria-label="Start with aeqi">
          <EconomyCard />
          <BlueprintCard />
          <ReferralCard />
          <LaunchTrustCard />
        </section>
      </div>

      <div className="home-floor">
        <LearnAeqiSection />
      </div>
    </div>
  );
}

function useCurrentDateTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

function BlueprintCard() {
  return (
    <article className="home-card home-card--blueprint home-card--elevated">
      <span className="home-launch-kicker">
        <FileText size={15} strokeWidth={1.7} aria-hidden="true" />
        Blueprint
      </span>
      <div className="home-launch-body">
        <h2 className="home-launch-title">First Company</h2>
        <p className="home-launch-hint">
          Review the default structure before you create the operating context.
        </p>
      </div>
      <div className="home-launch-actions">
        <Link to="/blueprints" className="home-primary-action home-primary-action--secondary">
          View blueprint
          <ArrowRight size={16} strokeWidth={1.8} />
        </Link>
      </div>
    </article>
  );
}

function LaunchTrustCard() {
  return (
    <article className="home-card home-card--launch home-card--elevated">
      <span className="home-launch-kicker">
        <Rocket size={15} strokeWidth={1.7} aria-hidden="true" />
        Launch
      </span>
      <div className="home-launch-body">
        <h2 className="home-launch-title">Launch a TRUST</h2>
        <p className="home-launch-hint">
          Name the workspace and create the first operating context.
        </p>
      </div>
      <div className="home-launch-actions">
        <Link to="/launch" className="home-primary-action">
          <Plus size={16} strokeWidth={1.8} />
          Launch TRUST
        </Link>
      </div>
    </article>
  );
}

function ReferralCard() {
  return (
    <article className="home-card home-card--referral home-card--elevated">
      <span className="home-launch-kicker">
        <Share2 size={15} strokeWidth={1.7} aria-hidden="true" />
        Referrals
      </span>
      <div className="home-launch-body">
        <h2 className="home-launch-title">Invite the first operators</h2>
        <p className="home-launch-hint">
          Keep the global home ready for referral loops, cohort updates, and public launch calls.
        </p>
      </div>
      <div className="home-launch-actions">
        <a
          href="mailto:?subject=Build%20with%20aeqi&body=https%3A%2F%2Fapp.aeqi.ai%2Flaunch"
          className="home-primary-action home-primary-action--secondary"
        >
          Invite someone
          <ArrowRight size={16} strokeWidth={1.8} />
        </a>
      </div>
    </article>
  );
}

function EconomyCard() {
  return (
    <article className="home-card home-card--economy home-card--elevated">
      <span className="home-launch-kicker">
        <Globe size={15} strokeWidth={1.7} aria-hidden="true" />
        Economy
      </span>
      <div className="home-launch-body">
        <h2 className="home-launch-title">Live Economy</h2>
        <p className="home-launch-hint">
          Browse public TRUSTs, open roles, and launch signals across the network.
        </p>
      </div>
      <div className="home-launch-actions">
        <Link to="/economy" className="home-primary-action home-primary-action--secondary">
          Open Economy
          <ArrowRight size={16} strokeWidth={1.8} />
        </Link>
      </div>
    </article>
  );
}

function LearnAeqiSection() {
  const [postIndex, setPostIndex] = useState(0);
  const activePost = LEARN_POSTS[postIndex % LEARN_POSTS.length];

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPostIndex((current) => (current + 1) % LEARN_POSTS.length);
    }, 5600);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="home-learn" aria-label="Learn aeqi">
      <div className="home-learn-head">
        <h2 className="home-learn-title">Learn more</h2>
      </div>
      <article className="home-learn-carousel">
        <a
          className="home-learn-carousel-media"
          href={activePost.href}
          target="_blank"
          rel="noreferrer"
        >
          <img
            key={activePost.image}
            src={activePost.image}
            alt=""
            className="home-learn-carousel-image"
            aria-hidden="true"
          />
        </a>
        <span key={activePost.href} className="home-learn-carousel-copy">
          <a
            className="home-learn-carousel-link"
            href={activePost.href}
            target="_blank"
            rel="noreferrer"
          >
            <span className="home-learn-post-kicker">{activePost.kicker}</span>
            <span className="home-learn-post-title">{activePost.title}</span>
            <span className="home-learn-post-summary">{activePost.summary}</span>
          </a>
          <span className="home-learn-progress" aria-label="Learning article rotation progress">
            <span key={activePost.href} className="home-learn-progress-bar" />
          </span>
        </span>
      </article>
      <aside className="home-learn-rail" aria-label="Learn aeqi links">
        <a
          className="home-learn-rail-card"
          href="https://aeqi.ai/docs"
          target="_blank"
          rel="noreferrer"
        >
          <span className="home-learn-rail-kicker">
            <BookOpen size={15} strokeWidth={1.7} aria-hidden="true" />
            Docs
          </span>
          <span className="home-learn-rail-title">Read docs</span>
          <span className="home-learn-rail-copy">TRUSTs, agents, quests, and launch basics.</span>
          <ArrowRight size={15} strokeWidth={1.8} />
        </a>
        <a
          className="home-learn-rail-card"
          href="https://x.com/aeqiai"
          target="_blank"
          rel="noreferrer"
        >
          <span className="home-learn-rail-kicker">
            <Users size={15} strokeWidth={1.7} aria-hidden="true" />
            Community
          </span>
          <span className="home-learn-rail-title">Follow aeqi</span>
          <span className="home-learn-rail-copy">Updates, builds, and operator notes.</span>
          <ArrowRight size={15} strokeWidth={1.8} />
        </a>
      </aside>
    </section>
  );
}
