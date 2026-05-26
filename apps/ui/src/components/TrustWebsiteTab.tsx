import TrustWebsitePanel from "./TrustWebsitePanel";
import "@/styles/overview.css";

export default function TrustWebsiteTab({ trustId }: { trustId: string }) {
  return (
    <div className="trust-overview trust-website-page">
      <header className="trust-apps-page-header">
        <h1 className="trust-apps-page-title">Website</h1>
        <div className="ideas-toolbar trust-apps-toolbar" aria-label="Website controls">
          <span className="ideas-toolbar-meta trust-apps-toolbar-summary">
            Public view, marketplace proof, and demo route
          </span>
        </div>
      </header>
      <TrustWebsitePanel trustId={trustId} mode="page" />
    </div>
  );
}
