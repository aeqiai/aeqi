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

interface WideRow {
  id: string;
  source: string;
  owner: string;
  status: string;
  module: string;
  purpose: string;
  budget: string;
  available: string;
  updated: string;
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

const sortableColumns: Array<TableColumn<DemoRow>> = [
  {
    key: "title",
    header: "Title",
    cell: (r) => r.title,
    width: "28%",
    sortable: true,
    sortAccessor: (r) => r.title,
  },
  {
    key: "occupant",
    header: "Occupant",
    cell: (r) => r.occupant,
    width: "28%",
    sortable: true,
    sortAccessor: (r) => r.occupant,
  },
  {
    key: "reportsTo",
    header: "Reports to",
    cell: (r) => r.reportsTo,
    width: "28%",
    sortable: true,
    sortAccessor: (r) => r.reportsTo,
  },
  {
    key: "created",
    header: "Created",
    cell: (r) => r.created,
    width: "16%",
    align: "end",
    sortable: true,
    sortAccessor: (r) => r.created,
  },
];

const wideRows: WideRow[] = [
  {
    id: "b1",
    source: "COMPANY",
    owner: "role · operations",
    status: "active",
    module: "Treasury",
    purpose: "runway",
    budget: "$48,000",
    available: "$31,240",
    updated: "12m",
  },
  {
    id: "b2",
    source: "B1",
    owner: "agent · launch",
    status: "active",
    module: "Events",
    purpose: "activation",
    budget: "$12,500",
    available: "$9,100",
    updated: "47m",
  },
  {
    id: "b3",
    source: "B1",
    owner: "role · product",
    status: "paused",
    module: "Inference",
    purpose: "research",
    budget: "$7,200",
    available: "$1,920",
    updated: "2h",
  },
];

const wideColumns: Array<TableColumn<WideRow>> = [
  { key: "id", header: "ID", cell: (r) => r.id, width: "72px", align: "center" },
  { key: "source", header: "Source", cell: (r) => r.source, width: "120px" },
  { key: "owner", header: "Owner", cell: (r) => r.owner, width: "180px" },
  { key: "status", header: "Status", cell: (r) => r.status, width: "120px" },
  { key: "module", header: "Module", cell: (r) => r.module, width: "140px" },
  { key: "purpose", header: "Purpose", cell: (r) => r.purpose, width: "160px" },
  { key: "budget", header: "Budget", cell: (r) => r.budget, width: "140px", align: "end" },
  {
    key: "available",
    header: "Available",
    cell: (r) => r.available,
    width: "140px",
    align: "end",
  },
  { key: "updated", header: "Updated", cell: (r) => r.updated, width: "120px", align: "end" },
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

export const Sortable: Story = {
  name: "Sortable columns",
  parameters: {
    docs: {
      description: {
        story:
          "Click any header marked `sortable` to cycle asc → desc → cleared. ▲ / ▼ shows the active column and direction. Strings sort case-insensitive (locale-aware); numbers / dates sort numerically. `null`/`undefined` accessor values sort to the end.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <Table
        columns={sortableColumns}
        data={demoRows}
        rowKey={(r) => r.id}
        ariaLabel="Roles — sortable"
      />
    </div>
  ),
};

export const SortableWithDefault: Story = {
  name: "Sortable — with default sort",
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <Table
        columns={sortableColumns}
        data={demoRows}
        rowKey={(r) => r.id}
        defaultSort={{ key: "title", dir: "asc" }}
        ariaLabel="Roles — default sort by title asc"
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

export const Loading: Story = {
  name: "Loading skeleton",
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <Table
        columns={demoColumns}
        data={[]}
        rowKey={(r) => r.id}
        loading
        skeletonRows={4}
        ariaLabel="Roles loading"
      />
    </div>
  ),
};

export const WideOperational: Story = {
  name: "Wide operational table",
  parameters: {
    docs: {
      description: {
        story:
          "Use `scrollWidth` for dense operational/on-chain data instead of local overflow wrappers and ad hoc min-width classes.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 1240 }}>
      <Table
        columns={wideColumns}
        data={wideRows}
        rowKey={(r) => r.id}
        density="compact"
        scrollWidth="lg"
        ariaLabel="Budget operations"
      />
    </div>
  ),
};

export const WideLoading: Story = {
  name: "Wide loading",
  render: () => (
    <div style={{ maxWidth: 1240 }}>
      <Table
        columns={wideColumns}
        data={[]}
        rowKey={(r) => r.id}
        density="compact"
        loading
        skeletonRows={5}
        scrollWidth="lg"
        ariaLabel="Budget operations loading"
      />
    </div>
  ),
};
