import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Globe, Plus, Rocket, Share2, Users } from "lucide-react";
import { LEARN_POSTS } from "./startPageLearnPosts";
import "@/styles/roles.css";

export default function StartPage() {
  return (
    <div className="home-page">
      <header className="home-hero home-hero--global" aria-label="aeqi home">
        <img src="/welcome/start-hero.png" alt="" className="home-hero-image" aria-hidden="true" />
        <div className="home-hero-overlay">
          <div className="home-hero-identity">
            <div className="home-hero-text">
              <p className="home-hero-eyebrow">The company OS</p>
              <h1 className="home-hero-title">aeqi</h1>
              <span className="home-hero-profile-copy">
                <span className="home-hero-subtitle">
                  Start something that can work without you.
                </span>
                <span className="home-hero-email">
                  Launch a TRUST, bring agents into the loop, and keep proof in one place.
                </span>
              </span>
            </div>
          </div>
        </div>
      </header>

      <section className="home-row-promos" aria-label="Start with aeqi">
        <LaunchTrustCard />
        <EconomyCard />
        <ReferralCard />
      </section>

      <LearnAeqiSection />
    </div>
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
          Name the workspace, choose the First Company blueprint, and create the first operating
          context.
        </p>
      </div>
      <div className="home-launch-actions">
        <Link to="/launch" className="home-primary-action">
          <Plus size={16} strokeWidth={1.8} />
          Launch TRUST
        </Link>
        <Link to="/blueprints" className="home-primary-action home-primary-action--secondary">
          View blueprint
          <ArrowRight size={16} strokeWidth={1.8} />
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
    <article className="home-card home-card--economy home-card--recessed">
      <div className="home-economy-media">
        <header className="home-economy-head">
          <span className="home-economy-label">
            <Globe size={15} strokeWidth={1.7} aria-hidden="true" />
            Economy
          </span>
        </header>
        <img
          src="/home/economy-mood.png"
          alt=""
          className="home-economy-image"
          aria-hidden="true"
        />
      </div>
      <div className="home-economy-content">
        <div className="home-economy-body">
          <p className="home-economy-lede">Public market surface</p>
          <p className="home-economy-aside">
            Discover TRUST listings, open roles, blueprints, and launch-ready funding surfaces.
          </p>
        </div>
        <Link
          to="/economy"
          className="home-primary-action home-primary-action--secondary home-economy-cta"
        >
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
      <article className="home-card home-card--learn home-card--recessed">
        <div className="home-learn-head">
          <h2 className="home-learn-title">Learn more</h2>
        </div>
        <div className="home-learn-carousel">
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
            <span className="home-learn-rotation" aria-label="Learning article rotation">
              {LEARN_POSTS.map((post, index) => (
                <button
                  key={post.href}
                  type="button"
                  className={`home-learn-dot${index === postIndex ? " home-learn-dot--active" : ""}`}
                  aria-label={`Show ${post.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setPostIndex(index);
                  }}
                />
              ))}
            </span>
          </span>
        </div>
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
