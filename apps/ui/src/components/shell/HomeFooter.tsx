import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Wordmark from "../Wordmark";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export default function HomeFooter() {
  return (
    <footer className="shell-home-footer" role="contentinfo">
      <div className="shell-home-footer-top">
        <div className="shell-home-footer-brand">
          <Wordmark size={26} className="shell-home-footer-wordmark" />
          <p className="shell-home-footer-copy">
            AEQI is an operating system for autonomous companies: agents, ideas, events, quests,
            sessions, executions, and the context that binds them.
          </p>
          <div className="shell-home-footer-signals" aria-label="platform signals">
            <a
              href="https://status.aeqi.ai"
              target="_blank"
              rel="noreferrer noopener"
              className="shell-home-footer-signal shell-home-footer-signal-status"
              title="System status"
            >
              <span className="shell-home-footer-status-dot" aria-hidden="true" />
              <span>Nominal</span>
            </a>
            <span className="shell-home-footer-signal">Open source</span>
            <span className="shell-home-footer-signal">Self-hostable</span>
            <span className="shell-home-footer-signal">Runtime-first</span>
          </div>
        </div>

        <div className="shell-home-footer-columns">
          <section className="shell-home-footer-column">
            <h2>Product</h2>
            <Link to="/templates">Templates</Link>
            <Link to="/agents">Agents</Link>
            <Link to="/new">Launch</Link>
            <Link to="/">Home</Link>
          </section>

          <section className="shell-home-footer-column">
            <h2>Developers</h2>
            <Link to="/profile?tab=api">API keys</Link>
            <Link to="/profile?tab=security">Security</Link>
            <ExternalLink href="https://github.com/aeqiai/aeqi">Source</ExternalLink>
            <ExternalLink href="https://aeqi.ai">Website</ExternalLink>
          </section>

          <section className="shell-home-footer-column">
            <h2>Trust</h2>
            <ExternalLink href="https://status.aeqi.ai">Status</ExternalLink>
            <ExternalLink href="https://aeqi.ai/privacy">Privacy</ExternalLink>
            <ExternalLink href="https://aeqi.ai/terms">Terms</ExternalLink>
            <span className="shell-home-footer-muted">v0.7.0</span>
          </section>
        </div>
      </div>

      <div className="shell-home-footer-bottom">
        <span className="shell-home-footer-copyright">© 2026 aeqi</span>
        <span className="shell-home-footer-bottom-copy">
          Infrastructure for autonomous companies, not a generic startup site.
        </span>
      </div>
    </footer>
  );
}
