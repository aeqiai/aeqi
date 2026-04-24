import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as r}from"./index-_tug67E6.js";import{M as t}from"./index-D11v2HJ2.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-BIintNDS.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function i(s){const n={code:"code",h1:"h1",h2:"h2",h3:"h3",li:"li",p:"p",strong:"strong",ul:"ul",...r(),...s.components};return e.jsxs(e.Fragment,{children:[e.jsx(t,{title:"Get Started/Welcome"}),`
`,e.jsx(n.h1,{id:"aeqi-component-library",children:"aeqi component library"}),`
`,e.jsxs(n.p,{children:["The reference for every primitive exported from ",e.jsx(n.code,{children:"@/components/ui"}),` and
the rules that keep them coherent. Use it to look up a component, copy
a working example, inspect a token, or see how primitives compose into
product patterns.`]}),`
`,e.jsx(n.h2,{id:"find-what-you-need",children:"Find what you need"}),`
`,e.jsxs(n.p,{children:[`| Goal                                      | Where to look                          |
| ----------------------------------------- | -------------------------------------- |
| Browse every primitive grouped by purpose | `,e.jsx(n.strong,{children:"Primitives"}),` in the sidebar          |
| Inspect a design token (click to copy)    | `,e.jsx(n.strong,{children:"Foundations → Color"}),` (and siblings) |
| See the design rules and philosophy       | `,e.jsx(n.strong,{children:"Foundations → Principles"}),`           |
| See composed UI recipes                   | `,e.jsx(n.strong,{children:"Patterns"}),` in the sidebar            |
| See the import surface and inventory      | `,e.jsx(n.strong,{children:"Get Started → Component Library"}),`    |
| Jump to a specific primitive by name      | Press `,e.jsx("kbd",{children:"/"})," to search           |"]}),`
`,e.jsx(n.h2,{id:"how-the-sidebar-is-organised",children:"How the sidebar is organised"}),`
`,e.jsx(n.h3,{id:"get-started",children:"Get Started"}),`
`,e.jsx(n.p,{children:`Orientation pages. Read these once. Come back to the Component Library
when you need the import surface or the "which primitive when" table.`}),`
`,e.jsx(n.h3,{id:"foundations",children:"Foundations"}),`
`,e.jsx(n.p,{children:`The design system itself — one scrollable page per concern so each is a
single read:`}),`
`,e.jsxs(n.p,{children:[`| Page           | What's in it                                         |
| -------------- | ---------------------------------------------------- |
| `,e.jsx(n.strong,{children:"Principles"}),` | Ratios, restraint rules, the four primitives         |
| `,e.jsx(n.strong,{children:"Color"}),`      | Surfaces, ink ladder, accent, status — click to copy |
| `,e.jsx(n.strong,{children:"Typography"}),` | Four font roles with live specimens + type scale     |
| `,e.jsx(n.strong,{children:"Spacing"}),`    | 4px grid visualised, row rhythm rules                |
| `,e.jsx(n.strong,{children:"Radii"}),`      | Six-step scale with live shapes                      |
| `,e.jsx(n.strong,{children:"Elevation"}),`  | Canonical lifted card vs alternatives                |
| `,e.jsx(n.strong,{children:"Motion"}),`     | Three cadences you can play side-by-side             |
| `,e.jsx(n.strong,{children:"Wordmark"}),"   | The æqi brand mark and its rules                     |"]}),`
`,e.jsx(n.h3,{id:"primitives",children:"Primitives"}),`
`,e.jsx(n.p,{children:"The 23 primitives, grouped by purpose so you don't scan a flat list:"}),`
`,e.jsxs(n.p,{children:[`| Bucket           | What lives here                                                      |
| ---------------- | -------------------------------------------------------------------- |
| `,e.jsx(n.strong,{children:"Actions"}),"      | ",e.jsx(n.code,{children:"Button"}),", ",e.jsx(n.code,{children:"IconButton"}),", ",e.jsx(n.code,{children:"Menu"}),`                                       |
| `,e.jsx(n.strong,{children:"Inputs"}),"       | ",e.jsx(n.code,{children:"Input"}),", ",e.jsx(n.code,{children:"Textarea"}),", ",e.jsx(n.code,{children:"Select"}),", ",e.jsx(n.code,{children:"Combobox"}),`                            |
| `,e.jsx(n.strong,{children:"Containers"}),"   | ",e.jsx(n.code,{children:"Card"}),", ",e.jsx(n.code,{children:"Panel"}),", ",e.jsx(n.code,{children:"Tabs"}),`                                              |
| `,e.jsx(n.strong,{children:"Data Display"})," | ",e.jsx(n.code,{children:"Badge"}),", ",e.jsx(n.code,{children:"DetailField"}),", ",e.jsx(n.code,{children:"HeroStats"}),", ",e.jsx(n.code,{children:"ProgressBar"}),", ",e.jsx(n.code,{children:"TagList"}),`        |
| `,e.jsx(n.strong,{children:"Overlays"}),"     | ",e.jsx(n.code,{children:"Modal"}),", ",e.jsx(n.code,{children:"Popover"}),", ",e.jsx(n.code,{children:"Tooltip"}),`                                        |
| `,e.jsx(n.strong,{children:"Feedback"}),"     | ",e.jsx(n.code,{children:"Spinner"}),", ",e.jsx(n.code,{children:"ThinkingDot"}),", ",e.jsx(n.code,{children:"EmptyState"}),", ",e.jsx(n.code,{children:"DataState"}),", ",e.jsx(n.code,{children:"ErrorBoundary"})," |"]}),`
`,e.jsxs(n.p,{children:["Every primitive carries ",e.jsx(n.code,{children:"autodocs"}),`, so each entry has a generated
`,e.jsx(n.strong,{children:"Docs"})," tab with prop tables alongside the hand-written stories."]}),`
`,e.jsx(n.h3,{id:"patterns",children:"Patterns"}),`
`,e.jsx(n.p,{children:`Composed recipes that show how primitives combine into dashboard UI.
Use these as starting templates, not as fixed screenshots.`}),`
`,e.jsxs(n.p,{children:[`| Pattern             | What it composes                              |
| ------------------- | --------------------------------------------- |
| `,e.jsx(n.strong,{children:"Agent Card"}),`      | Card + Badge + DetailField + TagList + Button |
| `,e.jsx(n.strong,{children:"Quest Row"}),`       | Badge + IconButton (dense list rhythm)        |
| `,e.jsx(n.strong,{children:"Empty Dashboard"})," | EmptyState + Button (first-run, zero-data)    |"]}),`
`,e.jsx(n.h2,{id:"useful-keyboard-shortcuts",children:"Useful keyboard shortcuts"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx("kbd",{children:"/"})," — focus the sidebar search"]}),`
`,e.jsxs(n.li,{children:[e.jsx("kbd",{children:"S"})," — toggle the sidebar"]}),`
`,e.jsxs(n.li,{children:[e.jsx("kbd",{children:"D"})," — switch to the docs view"]}),`
`,e.jsxs(n.li,{children:[e.jsx("kbd",{children:"C"})," — switch to the canvas view"]}),`
`,e.jsxs(n.li,{children:[e.jsx("kbd",{children:"F"})," — go fullscreen on the current story"]}),`
`,e.jsxs(n.li,{children:[e.jsx("kbd",{children:"A"})," — toggle the addons panel"]}),`
`,e.jsxs(n.li,{children:[e.jsx("kbd",{children:"T"})," — toggle the toolbar"]}),`
`]}),`
`,e.jsx(n.h2,{id:"conventions",children:"Conventions"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["Stories live next to their primitive in ",e.jsx(n.code,{children:"apps/ui/src/components/ui/"}),"."]}),`
`,e.jsxs(n.li,{children:["Story title format is ",e.jsx(n.code,{children:"Primitives/<bucket>/<primitive>"}),` — match this
when you add a new one.`]}),`
`,e.jsxs(n.li,{children:["Foundations and Patterns pages live in ",e.jsx(n.code,{children:"apps/ui/src/components/ui/docs/"}),`
so the primitive folder stays scannable.`]}),`
`,e.jsx(n.li,{children:`Use real strings from the dashboard ("Create Quest", "Assign Agent")
in examples, not "Lorem ipsum".`}),`
`,e.jsxs(n.li,{children:[`Never hardcode hex, radius, or transition values in a story — reach
for a token. The `,e.jsx(n.strong,{children:"Foundations → Color / Radii / Motion"}),` pages are
the source of truth.`]}),`
`]}),`
`,e.jsx(n.p,{children:"If a primitive ships in code without a story, the library is incomplete."})]})}function m(s={}){const{wrapper:n}={...r(),...s.components};return n?e.jsx(n,{...s,children:e.jsx(i,{...s})}):i(s)}export{m as default};
