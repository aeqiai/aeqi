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

export default function ShellFooter() {
  return (
    <footer className="shell-footer" role="contentinfo">
      <div className="shell-footer-brand">
        <Wordmark size={18} className="shell-footer-wordmark" />
        <span className="shell-footer-copy">Infrastructure for autonomous companies</span>
      </div>

      <a
        href="https://status.aeqi.ai"
        target="_blank"
        rel="noreferrer noopener"
        className="shell-footer-status"
        title="System status"
      >
        <span className="shell-footer-status-dot" aria-hidden="true" />
        <span>Nominal</span>
      </a>

      <nav className="shell-footer-nav" aria-label="Footer navigation">
        <Link to="/templates">Templates</Link>
        <Link to="/agents">Agents</Link>
        <Link to="/new">Launch</Link>
        <Link to="/profile?tab=api">API keys</Link>
        <Link to="/profile?tab=security">Security</Link>
        <ExternalLink href="https://aeqi.ai/privacy">Privacy</ExternalLink>
        <ExternalLink href="https://aeqi.ai/terms">Terms</ExternalLink>
      </nav>

      <span className="shell-footer-meta">v0.7.0 · © 2026 aeqi</span>
    </footer>
  );
}
