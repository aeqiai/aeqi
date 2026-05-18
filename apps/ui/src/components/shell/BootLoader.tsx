import { Loading } from "@/components/ui";

/**
 * Full-screen splash shown while the daemon store completes its first
 * fetch. Renders the canonical æqi wordmark with a gentle pulse so the
 * surface reads as deliberate rather than washed out.
 */
export default function BootLoader() {
  return <Loading variant="page" label="Loading runtime" />;
}
