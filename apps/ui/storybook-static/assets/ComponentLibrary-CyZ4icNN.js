import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as t}from"./index-_tug67E6.js";import{M as r}from"./index-C5DnYz3G.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-CnJ9QsOX.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function o(i){const n={code:"code",h1:"h1",h2:"h2",h3:"h3",li:"li",ol:"ol",p:"p",pre:"pre",ul:"ul",...t(),...i.components};return e.jsxs(e.Fragment,{children:[e.jsx(r,{title:"Get Started/Component Library"}),`
`,e.jsx(n.h1,{id:"component-inventory",children:"Component inventory"}),`
`,e.jsxs(n.p,{children:[`This page is the canonical inventory of primitives exported from
`,e.jsx(n.code,{children:"@/components/ui"}),`. The Welcome page tells you how the sidebar is organised;
this page tells you what is in the box.`]}),`
`,e.jsx(n.p,{children:"Every primitive in the library satisfies three conditions:"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["it is exported from ",e.jsx(n.code,{children:"src/components/ui/index.ts"})]}),`
`,e.jsx(n.li,{children:"it has at least one Storybook story"}),`
`,e.jsx(n.li,{children:"it consumes shared tokens instead of ad hoc local styling"}),`
`]}),`
`,e.jsx(n.h2,{id:"import-surface",children:"Import surface"}),`
`,e.jsx(n.pre,{children:e.jsx(n.code,{className:"language-ts",children:`import {
  Badge,
  Button,
  Card,
  Combobox,
  DataState,
  DetailField,
  EmptyState,
  ErrorBoundary,
  HeroStats,
  IconButton,
  Input,
  Menu,
  Modal,
  Panel,
  Popover,
  ProgressBar,
  Select,
  Spinner,
  Tabs,
  TagList,
  Textarea,
  ThinkingDot,
  Tooltip,
} from "@/components/ui";
`})}),`
`,e.jsx(n.h2,{id:"primitives-by-bucket",children:"Primitives by bucket"}),`
`,e.jsxs(n.p,{children:[`The sidebar mirrors these buckets. If you add a new primitive, retitle its
story `,e.jsx(n.code,{children:"Primitives/<bucket>/<name>"})," to keep the navigation aligned."]}),`
`,e.jsx(n.h3,{id:"actions",children:"Actions"}),`
`,e.jsxs(n.p,{children:[`| Primitive    | Purpose                                                 |
| ------------ | ------------------------------------------------------- |
| `,e.jsx(n.code,{children:"Button"}),`     | Primary, secondary, ghost, and destructive actions      |
| `,e.jsx(n.code,{children:"IconButton"}),` | Dense icon-only actions for toolbars and rows           |
| `,e.jsx(n.code,{children:"Menu"}),"       | Disclosed action list for overflow and per-row controls |"]}),`
`,e.jsx(n.h3,{id:"inputs",children:"Inputs"}),`
`,e.jsxs(n.p,{children:[`| Primitive  | Purpose                                                    |
| ---------- | ---------------------------------------------------------- |
| `,e.jsx(n.code,{children:"Input"}),`    | Single-line text input with label, hint, and error support |
| `,e.jsx(n.code,{children:"Textarea"}),` | Multi-line prose input using the same field language       |
| `,e.jsx(n.code,{children:"Select"}),`   | Native single-choice dropdown with consistent chrome       |
| `,e.jsx(n.code,{children:"Combobox"})," | Searchable single-choice picker over a known option set    |"]}),`
`,e.jsx(n.h3,{id:"containers",children:"Containers"}),`
`,e.jsxs(n.p,{children:[`| Primitive | Purpose                                                 |
| --------- | ------------------------------------------------------- |
| `,e.jsx(n.code,{children:"Card"}),`    | Generic grouped container with optional header/footer   |
| `,e.jsx(n.code,{children:"Panel"}),`   | Opinionated section container with title/actions chrome |
| `,e.jsx(n.code,{children:"Tabs"}),"    | Accessible tablist with counts and panel content        |"]}),`
`,e.jsx(n.h3,{id:"data-display",children:"Data Display"}),`
`,e.jsxs(n.p,{children:[`| Primitive     | Purpose                                        |
| ------------- | ---------------------------------------------- |
| `,e.jsx(n.code,{children:"Badge"}),`       | Status and metadata chips                      |
| `,e.jsx(n.code,{children:"DetailField"}),` | Label/value pair for settings and detail views |
| `,e.jsx(n.code,{children:"HeroStats"}),`   | Compact stats row for dashboards and summaries |
| `,e.jsx(n.code,{children:"ProgressBar"}),` | Determinate progress and workload indicators   |
| `,e.jsx(n.code,{children:"TagList"}),"     | Tag/chip list with optional empty fallback     |"]}),`
`,e.jsx(n.h3,{id:"overlays",children:"Overlays"}),`
`,e.jsxs(n.p,{children:[`| Primitive | Purpose                                           |
| --------- | ------------------------------------------------- |
| `,e.jsx(n.code,{children:"Modal"}),`   | Dialog shell for confirmations and forms          |
| `,e.jsx(n.code,{children:"Popover"}),` | Anchored floating surface for filters and pickers |
| `,e.jsx(n.code,{children:"Tooltip"})," | Hover/focus explanation for dense controls        |"]}),`
`,e.jsx(n.h3,{id:"feedback",children:"Feedback"}),`
`,e.jsxs(n.p,{children:[`| Primitive       | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `,e.jsx(n.code,{children:"Spinner"}),`       | Loading indicator (indeterminate)               |
| `,e.jsx(n.code,{children:"ThinkingDot"}),`   | Agent-thinking indicator for streaming surfaces |
| `,e.jsx(n.code,{children:"EmptyState"}),`    | No-data and zero-result placeholders            |
| `,e.jsx(n.code,{children:"DataState"}),`     | Loading / empty / content tri-state wrapper     |
| `,e.jsx(n.code,{children:"ErrorBoundary"})," | Render fallback UI when a subtree throws        |"]}),`
`,e.jsx(n.h2,{id:"adding-a-new-primitive",children:"Adding a new primitive"}),`
`,e.jsxs(n.ol,{children:[`
`,e.jsxs(n.li,{children:["Start from an existing one (",e.jsx(n.code,{children:"Input.tsx"})," / ",e.jsx(n.code,{children:"Input.module.css"})," are the cleanest template)."]}),`
`,e.jsxs(n.li,{children:["Props: ",e.jsx(n.code,{children:"variant"}),", ",e.jsx(n.code,{children:"size"}),", ",e.jsx(n.code,{children:"className"}),", then role-specific props. Always accept ",e.jsx(n.code,{children:"className"})," and forward it last so call sites can extend."]}),`
`,e.jsxs(n.li,{children:["CSS module: use ",e.jsx(n.code,{children:"--input-*"}),", ",e.jsx(n.code,{children:"--space-*"}),", ",e.jsx(n.code,{children:"--radius-*"}),", ",e.jsx(n.code,{children:"--text-*"})," tokens only."]}),`
`,e.jsxs(n.li,{children:["Add a Storybook story showing every variant and every size. Title it ",e.jsx(n.code,{children:"Primitives/<bucket>/<name>"}),"."]}),`
`,e.jsxs(n.li,{children:["Export from ",e.jsx(n.code,{children:"src/components/ui/index.ts"}),"."]}),`
`,e.jsx(n.li,{children:"Add the row to the bucket table above."}),`
`]}),`
`,e.jsx(n.p,{children:"If a primitive lands in code but not in this inventory, the library docs are incomplete."})]})}function u(i={}){const{wrapper:n}={...t(),...i.components};return n?e.jsx(n,{...i,children:e.jsx(o,{...i})}):o(i)}export{u as default};
