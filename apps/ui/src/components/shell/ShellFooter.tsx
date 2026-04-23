import type { ReactNode } from "react";
import { Link } from "react-router-dom";

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
        <span className="shell-footer-brandmark">aeqi</span>
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
        <Link to="/docs">Docs</Link>
        <ExternalLink href="https://aeqi.ai/privacy">Privacy</ExternalLink>
        <ExternalLink href="https://aeqi.ai/terms">Terms</ExternalLink>
      </nav>

      <span className="shell-footer-meta">v0.7.0</span>
    </footer>
  );
}
