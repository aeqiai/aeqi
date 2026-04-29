import { useNavigate } from "react-router-dom";
import { Button, EmptyState } from "@/components/ui";

/**
 * In-shell 404. Mounted by AppLayout when the URL doesn't match any
 * registered surface — prevents bogus paths from rendering nothing or
 * falling through to a stale active-entity view. Uses existing
 * primitives so it inherits the design system without bespoke CSS.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="asv-main">
      <EmptyState
        eyebrow="404"
        title="Page not found"
        description="That URL doesn't match anything in the app."
        action={
          <Button variant="primary" onClick={() => navigate("/")}>
            Go to home
          </Button>
        }
      />
    </div>
  );
}
