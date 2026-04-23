import Wordmark from "../Wordmark";

export default function ShellFooter() {
  return (
    <footer className="shell-footer" role="contentinfo">
      <p className="shell-footer-tagline">
        <Wordmark size={11} className="shell-footer-wordmark" color="currentColor" />
        <span>
          By using aeqi you agree to our{" "}
          <a href="https://aeqi.ai/privacy" target="_blank" rel="noreferrer noopener">
            privacy policy
          </a>{" "}
          and{" "}
          <a href="https://aeqi.ai/terms" target="_blank" rel="noreferrer noopener">
            terms of service
          </a>
          .
        </span>
      </p>
      <span className="shell-footer-meta">v0.7.0</span>
    </footer>
  );
}
