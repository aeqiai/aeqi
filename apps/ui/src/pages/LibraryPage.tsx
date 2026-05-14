import { useNavigate } from "react-router-dom";
import { Card, CardTrigger, Page, PageBody, PageHeader, PageSection } from "@/components/ui";
import type { Entity } from "@/lib/types";
import { entityBasePath } from "@/lib/entityPath";
import styles from "./LibraryPage.module.css";

interface LibraryPageProps {
  entity: Entity | null;
}

interface LibraryDestination {
  title: string;
  kicker: string;
  description: string;
  href: string;
}

export default function LibraryPage({ entity }: LibraryPageProps) {
  const navigate = useNavigate();
  const base = entity ? entityBasePath(entity) : "";

  const destinations: LibraryDestination[] = [
    {
      title: "Ideas",
      kicker: "Knowledge",
      description: "Specs, decisions, memories, and durable context agents can reason over.",
      href: `${base}/ideas`,
    },
    {
      title: "Blueprints",
      kicker: "Templates",
      description: "Reusable company, agent, event, quest, and idea templates for repeatable work.",
      href: "/blueprints",
    },
    {
      title: "Files",
      kicker: "Artifacts",
      description: "Raw assets and attachments shared with the organization runtime.",
      href: `${base}/drive`,
    },
  ];

  return (
    <Page width="wide" padding="md" gap="6">
      <PageHeader
        title="Library"
        description="Knowledge and artifacts for this organization. Ideas are interpreted memory; files are source material; blueprints are reusable operating patterns."
      />
      <PageBody gap="6">
        <PageSection
          title="Browse"
          description="The Library groups existing knowledge surfaces without hiding execution primitives like Agents, Quests, and Events."
        >
          <div className={styles.libraryGrid}>
            {destinations.map((destination) => (
              <CardTrigger
                key={destination.title}
                className={styles.libraryCard}
                onClick={() => navigate(destination.href)}
                aria-label={`Open ${destination.title}`}
              >
                <Card padding="md" interactive={false}>
                  <div className={styles.libraryCardInner}>
                    <div className={styles.libraryCardHeader}>
                      <div>
                        <h2 className={styles.libraryCardTitle}>{destination.title}</h2>
                        <div className={styles.libraryCardKicker}>{destination.kicker}</div>
                      </div>
                      <span className={styles.libraryCardArrow} aria-hidden="true">
                        -&gt;
                      </span>
                    </div>
                    <p className={styles.libraryCardDescription}>{destination.description}</p>
                  </div>
                </Card>
              </CardTrigger>
            ))}
          </div>
        </PageSection>

        <PageSection title="Model">
          <dl className={styles.libraryDefinitionList}>
            <div className={styles.libraryDefinition}>
              <dt>Ideas</dt>
              <dd>Interpreted memory, specs, decisions, and context that agents can recall.</dd>
            </div>
            <div className={styles.libraryDefinition}>
              <dt>Files</dt>
              <dd>Source artifacts such as contracts, images, PDFs, exports, and screenshots.</dd>
            </div>
            <div className={styles.libraryDefinition}>
              <dt>Blueprints</dt>
              <dd>Reusable recipes for creating companies, agents, routines, quests, and ideas.</dd>
            </div>
          </dl>
        </PageSection>
      </PageBody>
    </Page>
  );
}
