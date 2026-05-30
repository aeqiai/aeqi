import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LeftSidebar from "./LeftSidebar";
import { agentKeys, entityKeys } from "@/queries/keys";
import type { Agent, Trust } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";

const TRUST_ID = "root-1";

const sampleTrust: Trust = {
  id: TRUST_ID,
  name: "Eich Holding",
  type: "trust",
  status: "active",
  created_at: "2026-05-30T00:00:00Z",
  trust_address: TRUST_ID,
  agent_id: "agent-operator",
};

const sampleAgents: Agent[] = [
  {
    id: "agent-operator",
    name: "Operator",
    status: "active",
    trust_id: TRUST_ID,
  },
];

const seedShellState = (collapsed: boolean) => {
  useDaemonStore.setState({
    status: null,
    dashboard: null,
    cost: null,
    entities: [sampleTrust],
    agents: sampleAgents,
    quests: [],
    events: [],
    workerEvents: [],
    wsConnected: true,
    loading: false,
    initialLoaded: true,
    agentsLoaded: true,
  });

  useUIStore.setState({
    activeEntity: TRUST_ID,
    sidebarCollapsed: collapsed,
    sidebarWidth: 180,
    collapsedGroups: {},
  });

  useAuthStore.setState({
    token: "storybook",
    appMode: "platform",
    authMode: "accounts",
    authModeLoaded: true,
    user: {
      id: "user-storybook",
      email: "operator@aeqi.ai",
      name: "Operator",
      is_admin: true,
      roots: [TRUST_ID],
      entities: [TRUST_ID],
    },
  });
};

function pathOnly(route: string) {
  return route.split("?")[0];
}

function ShellStory({
  route,
  collapsed = false,
  height = 640,
}: {
  route: string;
  collapsed?: boolean;
  height?: number;
}) {
  seedShellState(collapsed);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(entityKeys.all, [sampleTrust]);
  queryClient.setQueryData(agentKeys.directory(), sampleAgents);
  queryClient.setQueryData(["runtime", "status", TRUST_ID], {
    has_runtime: true,
    host_active: true,
    plan: "standard",
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <div
          style={{
            display: "flex",
            height,
            minHeight: height,
            background: "var(--bg-sidebar)",
          }}
        >
          <Routes>
            <Route
              path="/trust/:trustId/*"
              element={<LeftSidebar trustId={TRUST_ID} path={pathOnly(route)} />}
            />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof LeftSidebar> = {
  title: "Patterns/App Shell/LeftSidebar",
  component: LeftSidebar,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Authenticated app sidebar with normal pinned rows, independently open trust groups, compact trust rows, and design-system icons. Use these stories for the 640px shell review before shipping navigation changes.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof LeftSidebar>;

export const PinnedSessions: Story = {
  name: "Pinned sessions / Operations open",
  render: () => <ShellStory route="/trust/root-1/sessions?view=mine" />,
};

export const OwnershipOpen: Story = {
  name: "Assets / Ownership open",
  render: () => <ShellStory route="/trust/root-1/assets" height={720} />,
};

export const Collapsed: Story = {
  name: "Collapsed rail",
  render: () => <ShellStory route="/trust/root-1/sessions?view=mine" collapsed />,
};
