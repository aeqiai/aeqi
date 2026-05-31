# Role Template Packs

Role templates are native installable role structures for an existing COMPANY.
They are not whole-COMPANY blueprints filtered down in the UI.

## Product Contract

- A role template installs one role into the current COMPANY.
- A role template pack installs a small authority structure, such as Director,
  Operator, and Advisor roles with their reporting edges.
- Installing a role template must never replace or delete the current company's
  existing roles.
- The install flow may optionally attach a default agent, leave the role
  vacant, or prepare the role for a human invite.
- Anyone attached to a COMPANY but outside the org chart should resolve to at
  least an Advisor role.

## Suggested API Shape

```ts
interface RoleTemplate {
  id: string;
  name: string;
  tagline?: string;
  role_title: string;
  role_type: "owner" | "director" | "operational" | "advisor";
  grants?: string[];
  default_occupant?: "agent" | "human" | "vacant";
  agent_template_id?: string;
}

interface RoleTemplatePack {
  id: string;
  name: string;
  tagline?: string;
  roles: RoleTemplate[];
  role_edges: Array<{
    parent_template_role_id: string;
    child_template_role_id: string;
  }>;
}
```

## Install Contract

`POST /api/role-templates/:id/install`

```ts
interface InstallRoleTemplateRequest {
  company_id: string;
  parent_role_id?: string;
  occupant?: "agent" | "human" | "vacant";
}
```

The implementation should create roles through the role registry, create edges
explicitly, and seed related agent/template artifacts when requested. It should
not call whole-blueprint spawn code that clears existing role data.
