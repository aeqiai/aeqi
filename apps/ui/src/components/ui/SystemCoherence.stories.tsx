import type { Meta, StoryObj } from "@storybook/react";
import { RefreshCw } from "lucide-react";
import { Badge } from "./Badge";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Card } from "./Card";
import { DetailField } from "./DetailField";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import {
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  PageToolbar,
} from "./Page";
import { Select } from "./Select";
import { StatusRow } from "./StatusRow";
import { Table, type TableColumn } from "./Table";
import { TagList } from "./TagList";
import styles from "./SystemCoherence.module.css";

const meta: Meta = {
  title: "Get Started/System Coherence",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A single review canvas for judging whether primitives read as one product system. Use this before shipping primitive changes.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

interface QuestRow {
  id: string;
  quest: string;
  owner: string;
  status: "working" | "blocked" | "done";
  updated: string;
}

const rows: QuestRow[] = [
  {
    id: "q-187",
    quest: "Normalize launch flow",
    owner: "founder-ops",
    status: "working",
    updated: "12m",
  },
  {
    id: "q-188",
    quest: "Review billing webhook",
    owner: "runtime",
    status: "blocked",
    updated: "47m",
  },
  {
    id: "q-189",
    quest: "Publish operator docs",
    owner: "docs",
    status: "done",
    updated: "2h",
  },
];

const columns: Array<TableColumn<QuestRow>> = [
  {
    key: "quest",
    header: "Quest",
    width: "38%",
    cell: (row) => <span className={styles.tableCellStrong}>{row.quest}</span>,
  },
  {
    key: "owner",
    header: "Owner",
    width: "22%",
    cell: (row) => <span className={styles.tableCellMuted}>{row.owner}</span>,
  },
  {
    key: "status",
    header: "Status",
    width: "20%",
    cell: (row) => (
      <Badge
        variant={
          row.status === "blocked" ? "warning" : row.status === "done" ? "success" : "accent"
        }
        size="sm"
        dot
      >
        {row.status === "done" ? "Done" : row.status === "blocked" ? "Blocked" : "Working"}
      </Badge>
    ),
  },
  {
    key: "updated",
    header: "Updated",
    width: "20%",
    align: "end",
    cell: (row) => <span className={styles.tableCellMuted}>{row.updated}</span>,
  },
];

export const ReviewCanvas: Story = {
  name: "Review canvas",
  render: () => (
    <main className={styles.frame}>
      <div className={styles.shell}>
        <aside className={styles.rail}>
          <div className={styles.brand}>
            <span className={styles.wordmark}>aeqi</span>
            <Badge variant="accent" size="sm">
              MVP
            </Badge>
          </div>
          <div className={styles.railGroup}>
            <span className={styles.railLabel}>Workspace</span>
            <span className={`${styles.railItem} ${styles.railItemActive}`}>
              Launch{" "}
              <Badge variant="success" size="sm" dot>
                Ready
              </Badge>
            </span>
            <span className={styles.railItem}>Quests</span>
            <span className={styles.railItem}>Agents</span>
            <span className={styles.railItem}>Settings</span>
          </div>
          <StatusRow dot="active" label="Runtime online" status="healthy" />
          <StatusRow dot="warning" label="Billing review" status="pending" />
        </aside>

        <Page className={styles.content} width="full" padding="none" gap="5">
          <PageHeader
            title="Launch cockpit"
            description="A dense operating surface using the same field, badge, table, card, action, and page language."
            actions={
              <Badge variant="info" dot>
                In Review
              </Badge>
            }
          />

          <PageBody gap="5">
            <PageToolbar
              aria-label="Launch work controls"
              grow
              actions={
                <>
                  <IconButton aria-label="Refresh launch work" variant="bordered" size="sm">
                    <Icon icon={RefreshCw} size="sm" />
                  </IconButton>
                  <Button variant="primary" size="sm">
                    New Quest
                  </Button>
                </>
              }
            >
              <Input size="sm" placeholder="Search launch work" aria-label="Search launch work" />
              <Select
                size="sm"
                value="all"
                onChange={() => {}}
                aria-label="Filter owner"
                options={[
                  { value: "all", label: "All owners" },
                  { value: "runtime", label: "Runtime" },
                  { value: "docs", label: "Docs" },
                ]}
              />
            </PageToolbar>

            <div className={styles.mainGrid}>
              <div className={styles.stack}>
                <Card padding="md">
                  <PageSection
                    title="Launch queue"
                    description="Current work grouped for scan-first review."
                  >
                    <MetricGrid columns={3}>
                      <MetricCard label="Open" value="18" />
                      <MetricCard label="Blocked" value="2" />
                      <MetricCard label="Today" value="7" />
                    </MetricGrid>

                    <Banner kind="info">
                      This canvas should feel like the app, not a component showroom.
                    </Banner>

                    <Table
                      columns={columns}
                      data={rows}
                      rowKey={(row) => row.id}
                      density="compact"
                      ariaLabel="Launch quest review"
                    />
                  </PageSection>
                </Card>

                <Card padding="md" variant="surface">
                  <PageSection title="Create a follow-up">
                    <div className={styles.formGrid}>
                      <Input label="Quest" placeholder="Review activation email" />
                      <Select
                        value="launch"
                        onChange={() => {}}
                        aria-label="Quest scope"
                        options={[
                          { value: "launch", label: "Launch" },
                          { value: "runtime", label: "Runtime" },
                          { value: "docs", label: "Docs" },
                        ]}
                      />
                    </div>
                    <div className={styles.actions}>
                      <Button variant="secondary">Cancel</Button>
                      <Button variant="primary">Create</Button>
                    </div>
                  </PageSection>
                </Card>
              </div>

              <div className={styles.stack}>
                <Card padding="md">
                  <PageSection
                    title="System fit"
                    actions={<Badge variant="success">Coherent</Badge>}
                  >
                    <DetailField label="Surface ladder">{"paper -> card -> elevated"}</DetailField>
                    <DetailField label="Control rhythm">28 / 32 / 40 px</DetailField>
                    <DetailField label="Radius rule">8 px cards, 12 px modals</DetailField>
                    <TagList items={["graphite", "quiet", "dense", "tokenized"]} />
                    <div className={styles.reviewNote}>
                      If a primitive looks louder here than it does alone, its token balance is
                      wrong.
                    </div>
                  </PageSection>
                </Card>

                <Card padding="md">
                  <EmptyState
                    title="No visual exceptions"
                    description="New UI should compose from this surface before inventing another class."
                    action={<Button variant="secondary">Open Inventory</Button>}
                  />
                </Card>
              </div>
            </div>
          </PageBody>
        </Page>
      </div>
    </main>
  ),
};
