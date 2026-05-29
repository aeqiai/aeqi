export const DEFAULT_TRUST_ID = "C68sd4DX6K7aSLaTyfPnAw7cqN5Fj82qX7JyuDj8NVY4";
export const DEFAULT_ROLE_ID = "0743269c-9109-49c0-b61e-990ceb36b1c4";

export const checks = {
  login: {
    auth: false,
    url: () => "/login",
    expectText: ["Sign in"],
  },
  "trust-roles": {
    auth: true,
    url: ({ trust }) => `/trust/${trust}/roles`,
    expectText: ["Roles"],
  },
  "trust-roles-list": {
    auth: true,
    url: ({ trust }) => `/trust/${trust}/roles?view=list`,
    expectText: ["Roles"],
  },
  "trust-tools": {
    auth: true,
    url: ({ trust }) => `/trust/${trust}/tools`,
    expectText: ["Tools", "Default agent"],
    expectSelector: [
      ".trust-tools-main",
      ".agent-settings-tool-row",
      ".agent-settings-tool-state",
    ],
    layout: ["trust-tools"],
  },
  "role-detail": {
    auth: true,
    url: ({ trust, roleId }) => `/trust/${trust}/roles/${roleId}`,
    expectText: ["Role idea", "Details", "Activity"],
    expectSelector: [
      ".trust-role-detail-document",
      ".trust-role-detail-inspector",
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
