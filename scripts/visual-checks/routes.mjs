export const DEFAULT_COMPANY_ID = "C68sd4DX6K7aSLaTyfPnAw7cqN5Fj82qX7JyuDj8NVY4";
export const DEFAULT_ROLE_ID = "0743269c-9109-49c0-b61e-990ceb36b1c4";

export const checks = {
  login: {
    auth: false,
    url: () => "/login",
    expectText: ["Sign in"],
  },
  "company-roles": {
    auth: true,
    url: ({ company }) => `/company/${company}/roles`,
    expectText: ["Roles"],
    layout: ["primitive-shell"],
  },
  "company-roles-list": {
    auth: true,
    url: ({ company }) => `/company/${company}/roles?view=list`,
    expectText: ["Roles"],
  },
  "company-tools": {
    auth: true,
    url: ({ company }) => `/company/${company}/tools`,
    expectText: ["Tools", "Default agent"],
    expectSelector: [
      ".company-tools-main",
      ".agent-settings-tool-row",
      ".agent-settings-tool-state",
    ],
    layout: ["primitive-shell", "company-tools"],
  },
  "role-detail": {
    auth: true,
    url: ({ company, roleId }) => `/company/${company}/roles/${roleId}`,
    expectText: ["Role idea", "Details", "Activity"],
    expectSelector: [
      ".company-role-detail-document",
      ".company-role-detail-inspector",
      ".idea-convo-section-count",
    ],
    layout: ["role-detail"],
  },
};

export function listChecks() {
  return Object.entries(checks).map(([name, check]) => ({
    name,
    auth: check.auth,
    layout: check.layout ?? [],
  }));
}
