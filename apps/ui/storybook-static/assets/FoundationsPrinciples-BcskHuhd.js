import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as t}from"./index-_tug67E6.js";import{M as r}from"./index-CiKHI0Eo.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function i(s){const n={blockquote:"blockquote",code:"code",h1:"h1",h2:"h2",li:"li",p:"p",strong:"strong",ul:"ul",...t(),...s.components};return e.jsxs(e.Fragment,{children:[e.jsx(r,{title:"Foundations/Principles"}),`
`,e.jsx(n.h1,{id:"principles",children:"Principles"}),`
`,e.jsxs(n.blockquote,{children:[`
`,e.jsxs(n.p,{children:[e.jsx(n.strong,{children:"v4 — Graphite + Ink."}),` The aeqi design system is built on restraint.
Every element earns its place through function, not decoration. The
interface recedes so the four primitives — Agents, Events, Quests,
Ideas — can speak clearly.`]}),`
`]}),`
`,e.jsx(n.h2,{id:"restraint-with-one-accent",children:"Restraint, with one accent"}),`
`,e.jsx(n.p,{children:`Pure neutral paper, ink at opacity, one near-black graphite accent. The
accent earns its weight by scarcity: wordmark, primary CTA, links, focus,
active state. Titles stay ink. The system is restrained, not monochrome.`}),`
`,e.jsx(n.p,{children:e.jsx(n.strong,{children:"Ratio rule — hold these or it goes generic:"})}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsx(n.li,{children:"~70% neutral grey paper + white card surfaces"}),`
`,e.jsx(n.li,{children:"~28% ink body copy (black at 22–92% alpha)"}),`
`,e.jsx(n.li,{children:"~2% near-black graphite accent (CTAs, active nav, focus, selected, wordmark)"}),`
`]}),`
`,e.jsxs(n.p,{children:["Jade is reserved for the ",e.jsx(n.strong,{children:"success"}),` semantic (completed quests, resolved
events) so brand and status signal read visually distinct.`]}),`
`,e.jsx(n.h2,{id:"opacity-as-depth",children:"Opacity as depth"}),`
`,e.jsxs(n.p,{children:[`A single black at varying opacities carries hierarchy inside the ink
system. No grey tints with their own hue — just black with more or less
presence. See `,e.jsx(n.strong,{children:"Foundations → Color"})," for the full ink ladder."]}),`
`,e.jsx(n.h2,{id:"precision-over-decoration",children:"Precision over decoration"}),`
`,e.jsx(n.p,{children:`No gratuitous gradients, heavy shadows, or extravagant rounding.
Components use sharp geometry and minimal chrome. Status color (success,
error, warning, info) appears sparingly — a dot, a tint — never a
full-bleed wash.`}),`
`,e.jsx(n.h2,{id:"the-four-primitives",children:"The four primitives"}),`
`,e.jsx(n.p,{children:"Everything in aeqi maps to one of four primitives:"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Agents"})," — autonomous entities with parent-child hierarchy (WHO)"]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Events"})," — triggers and audit stream (WHEN)"]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Quests"})," — work items agents pursue (WHAT)"]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Ideas"})," — knowledge, identity, instructions, memories (HOW)"]}),`
`]}),`
`,e.jsx(n.p,{children:`The UI is a vehicle for these four. When in doubt about whether a piece
of chrome belongs, ask: does it serve one of the four, or does it
compete with them?`}),`
`,e.jsx(n.h2,{id:"rule-of-least-chrome",children:"Rule of least chrome"}),`
`,e.jsxs(n.p,{children:["Reach for ",e.jsx(n.code,{children:"components/ui/"}),` before writing a new class. A new ad-hoc style
is the last resort, not the default. If the thing you want doesn't exist
as a primitive, propose adding it to the library before writing a
one-off class in a page-level stylesheet.`]}),`
`,e.jsxs(n.p,{children:["See ",e.jsx(n.strong,{children:"Get Started → Component Library"}),` for the canonical inventory and
the "which primitive to use when" table.`]}),`
`,e.jsx(n.h2,{id:"sources-of-truth",children:"Sources of truth"}),`
`,e.jsxs(n.p,{children:[`| Artifact                            | Role                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `,e.jsx(n.code,{children:"packages/tokens/src/tokens.css"}),"    | ",e.jsx(n.strong,{children:"Values"}),`: colors, fonts, spacing, radii, shadows, motion. The one source. |
| `,e.jsx(n.code,{children:"packages/tokens/src/tokens.ts"}),`     | TypeScript mirror of tokens.css — for canvas/chart/JS consumers.            |
| `,e.jsx(n.code,{children:"apps/ui/src/styles/primitives.css"}),` | Dashboard aliases + dashboard-only tokens (input-h, sidebar, etc).          |
| `,e.jsx(n.code,{children:"apps/ui/src/components/ui/"}),`        | Primitives + Storybook stories — the component API.                         |
| `,e.jsx(n.code,{children:"/brand"}),` on aeqi.ai                 | Public brand reference — palette, typography, downloads.                    |
| `,e.jsx(n.code,{children:"apps/ui/.impeccable.md"}),"            | AI context file — design philosophy + pointer to this doc.                  |"]})]})}function j(s={}){const{wrapper:n}={...t(),...s.components};return n?e.jsx(n,{...s,children:e.jsx(i,{...s})}):i(s)}export{j as default};
