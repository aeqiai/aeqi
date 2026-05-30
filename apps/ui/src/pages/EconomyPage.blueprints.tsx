import { Blocks } from "lucide-react";
import { Button, PageSection } from "@/components/ui";
import styles from "./EconomyPage.module.css";

export function BlueprintDiscoverySection({ onBrowse }: { onBrowse: () => void }) {
  return (
    <PageSection
      title="Start from a Blueprint"
      description="Blueprints supply the TRUST shell, seeded roles, agents, quests, ideas, and operating memory."
    >
      <div className={styles.blueprintLane}>
        <div className={styles.blueprintLaneMain}>
          <span className={styles.blueprintLaneTitle}>Launch supply</span>
          <span className={styles.blueprintLaneCopy}>
            Choose a Blueprint before launching a new TRUST, or inspect existing TRUSTs below for
            operating references.
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={onBrowse}
          leadingIcon={<Blocks size={13} strokeWidth={1.5} />}
        >
          Browse Blueprints
        </Button>
      </div>
    </PageSection>
  );
}
