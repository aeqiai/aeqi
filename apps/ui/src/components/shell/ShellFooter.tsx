import Wordmark from "../Wordmark";

export default function ShellFooter() {
  return (
    <footer className="shell-footer" role="contentinfo">
      <p className="shell-footer-tagline">
        By using <Wordmark size={9} className="shell-footer-wordmark" color="currentColor" /> you
        agree to our{" "}
        <a href="https://aeqi.ai/privacy" target="_blank" rel="noreferrer noopener">
          privacy policy
        </a>{" "}
        and{" "}
        <a href="https://aeqi.ai/terms" target="_blank" rel="noreferrer noopener">
          terms of service
        </a>
        .
      </p>
      <a
        href="https://status.aeqi.ai"
        target="_blank"
        rel="noreferrer noopener"
        className="shell-footer-meta"
        title="System status"
      >
        {`v${__APP_VERSION__}`}
      </a>
    </footer>
  );
}
