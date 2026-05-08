import type { Meta, StoryObj } from "@storybook/react";
import { Table, type TableColumn } from "./Table";

const meta: Meta<typeof Table> = {
  title: "Primitives/Containers/Table",
  component: Table,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Notion-minimal data table. Real `<table>` semantics so columns align between header and rows; tabular numerics line up; screen readers announce structure. No hairlines — separation is implicit, hover paints the elevated tint. The canonical answer for every list view in the app.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Table>;

interface DemoRow {
  id: string;
  title: string;
  occupant: string;
  reportsTo: string;
  created: string;
}

const demoRows: DemoRow[] = [
  { id: "r1", title: "CEO", occupant: "Luca Eich", reportsTo: "—", created: "2026-04-12" },
  { id: "r2", title: "CTO", occupant: "agent · ada", reportsTo: "CEO", created: "2026-04-12" },
  { id: "r3", title: "COO", occupant: "agent · ops", reportsTo: "CEO", created: "2026-04-13" },
  {
    id: "r4",
    title: "Backend Engineer",
    occupant: "agent · turing",
    reportsTo: "CTO",
    created: "2026-04-14",
  },
  {
    id: "r5",
    title: "Backend Intern",
    occupant: "vacant",
    reportsTo: "Backend Engineer",
    created: "2026-04-15",
  },
];

const demoColumns: Array<TableColumn<DemoRow>> = [
  { key: "title", header: "Title", cell: (r) => r.title, width: "28%" },
  { key: "occupant", header: "Occupant", cell: (r) => r.occupant, width: "28%" },
  { key: "reportsTo", header: "Reports to", cell: (r) => r.reportsTo, width: "28%" },
  { key: "created", header: "Created", cell: (r) => r.created, width: "16%", align: "end" },
];

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <Table columns={demoColumns} data={demoRows} rowKey={(r) => r.id} ariaLabel="Roles example" />
    </div>
  ),
};

export const Clickable: Story = {
  name: "Clickable rows",
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <Table
        columns={demoColumns}
        data={demoRows}
        rowKey={(r) => r.id}
        onRowClick={(row) => alert(`opened ${row.title}`)}
        ariaLabel="Roles — clickable rows"
      />
    </div>
  ),
};

export const Compact: Story = {
  name: "Compact density",
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <Table
        columns={demoColumns}
        data={demoRows}
        rowKey={(r) => r.id}
        density="compact"
        ariaLabel="Roles — compact"
      />
    </div>
  ),
};

export const Empty: Story = {
  name: "Empty state",
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <Table
        columns={demoColumns}
        data={[]}
        rowKey={(r) => r.id}
        empty={
          <div
            style={{
              padding: "var(--space-8)",
              textAlign: "center",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            No rows to show.
          </div>
        }
        ariaLabel="Empty roles table"
      />
    </div>
  ),
};
