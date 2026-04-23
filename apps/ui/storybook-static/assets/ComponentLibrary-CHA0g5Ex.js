import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as t}from"./index-_tug67E6.js";import{M as o}from"./index-M0FCBFYg.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-CELzUda2.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function r(i){const n={code:"code",h1:"h1",h2:"h2",h3:"h3",li:"li",p:"p",pre:"pre",ul:"ul",...t(),...i.components};return e.jsxs(e.Fragment,{children:[e.jsx(o,{title:"Library/Component Library"}),`
`,e.jsx(n.h1,{id:"aeqi-component-library",children:"aeqi component library"}),`
`,e.jsxs(n.p,{children:[`This Storybook is the public reference for the primitives exported from
`,e.jsx(n.code,{children:"@/components/ui"}),"."]}),`
`,e.jsx(n.p,{children:"Every primitive in the library should satisfy three conditions:"}),`
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
  DataState,
  DetailField,
  EmptyState,
  ErrorBoundary,
  HeroStats,
  IconButton,
  Input,
  Modal,
  Panel,
  ProgressBar,
  Spinner,
  Tabs,
  TagList,
  Textarea,
  Tooltip,
} from "@/components/ui";
`})}),`
`,e.jsx(n.h2,{id:"current-primitives",children:"Current primitives"}),`
`,e.jsx(n.p,{children:"The current public library exposes 18 primitives."}),`
`,e.jsx(n.h3,{id:"actions-and-input",children:"Actions and input"}),`
`,e.jsxs(n.p,{children:[`| Primitive | Purpose |
| --- | --- |
| `,e.jsx(n.code,{children:"Button"}),` | Primary, secondary, ghost, and destructive actions |
| `,e.jsx(n.code,{children:"IconButton"}),` | Dense icon-only actions for toolbars and rows |
| `,e.jsx(n.code,{children:"Input"}),` | Single-line text input with label, hint, and error support |
| `,e.jsx(n.code,{children:"Textarea"})," | Multi-line prose input using the same field language |"]}),`
`,e.jsx(n.h3,{id:"structure-and-data-display",children:"Structure and data display"}),`
`,e.jsxs(n.p,{children:[`| Primitive | Purpose |
| --- | --- |
| `,e.jsx(n.code,{children:"Card"}),` | Generic grouped container with optional header/footer |
| `,e.jsx(n.code,{children:"Panel"}),` | Opinionated section container with title/actions chrome |
| `,e.jsx(n.code,{children:"Tabs"}),` | Accessible tablist with counts and panel content |
| `,e.jsx(n.code,{children:"DetailField"}),` | Label/value pair for settings and detail views |
| `,e.jsx(n.code,{children:"HeroStats"}),` | Compact stats row for dashboards and summaries |
| `,e.jsx(n.code,{children:"ProgressBar"}),` | Determinate progress and workload indicators |
| `,e.jsx(n.code,{children:"TagList"})," | Tag/chip list with optional empty fallback |"]}),`
`,e.jsx(n.h3,{id:"feedback-status-and-overlays",children:"Feedback, status, and overlays"}),`
`,e.jsxs(n.p,{children:[`| Primitive | Purpose |
| --- | --- |
| `,e.jsx(n.code,{children:"Badge"}),` | Status and metadata chips |
| `,e.jsx(n.code,{children:"EmptyState"}),` | No-data and zero-result placeholders |
| `,e.jsx(n.code,{children:"DataState"}),` | Loading / empty / content tri-state wrapper |
| `,e.jsx(n.code,{children:"Spinner"}),` | Loading indicator |
| `,e.jsx(n.code,{children:"Tooltip"}),` | Hover/focus explanation for dense controls |
| `,e.jsx(n.code,{children:"Modal"}),` | Dialog shell for confirmations and forms |
| `,e.jsx(n.code,{children:"ErrorBoundary"})," | Render fallback UI when a subtree throws |"]}),`
`,e.jsx(n.h2,{id:"how-to-read-this-storybook",children:"How to read this Storybook"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.code,{children:"Foundations"})," documents tokens, surfaces, typography, motion, and rules."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.code,{children:"Components"})," holds reusable UI primitives."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.code,{children:"Feedback"})," holds status, loading, empty, and overlay primitives that are still part of the component library."]}),`
`]}),`
`,e.jsx(n.p,{children:"If a new primitive lands in code but not in Storybook, the library docs are incomplete."})]})}function j(i={}){const{wrapper:n}={...t(),...i.components};return n?e.jsx(n,{...i,children:e.jsx(r,{...i})}):r(i)}export{j as default};
