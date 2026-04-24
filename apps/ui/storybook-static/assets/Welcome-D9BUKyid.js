import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as r}from"./index-_tug67E6.js";import{M as o}from"./index-C5DnYz3G.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-CnJ9QsOX.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function i(s){const n={code:"code",h1:"h1",h2:"h2",li:"li",p:"p",strong:"strong",ul:"ul",...r(),...s.components};return e.jsxs(e.Fragment,{children:[e.jsx(o,{title:"Get Started/Welcome"}),`
`,e.jsx(n.h1,{id:"aeqi-component-library",children:"aeqi component library"}),`
`,e.jsxs(n.p,{children:["The reference for every primitive exported from ",e.jsx(n.code,{children:"@/components/ui"}),`. Use it
to look up a component, copy a working example, or check what tokens a
surface should consume.`]}),`
`,e.jsx(n.h2,{id:"find-what-you-need",children:"Find what you need"}),`
`,e.jsxs(n.p,{children:[`| Goal                                                        | Where to look                       |
| ----------------------------------------------------------- | ----------------------------------- |
| Browse every primitive grouped by purpose                   | `,e.jsx(n.strong,{children:"Primitives"}),` in the sidebar       |
| See the design system rules (colors, type, spacing, motion) | `,e.jsx(n.strong,{children:"Foundations → Design Language"}),`   |
| See the full inventory and import surface                   | `,e.jsx(n.strong,{children:"Get Started → Component Library"}),` |
| Jump to a specific primitive by name                        | Press `,e.jsx("kbd",{children:"/"}),` to search        |
| Walk every story for one primitive                          | Click its name, then arrow keys     |`]}),`
`,e.jsx(n.h2,{id:"how-the-sidebar-is-organised",children:"How the sidebar is organised"}),`
`,e.jsxs(n.p,{children:[e.jsx(n.strong,{children:"Primitives"}),` is the meat of the library. It splits into six buckets so you
do not have to scan a flat list of 20+ items:`]}),`
`,e.jsxs(n.p,{children:[`| Bucket           | What lives here                                                      |
| ---------------- | -------------------------------------------------------------------- |
| `,e.jsx(n.strong,{children:"Actions"}),"      | ",e.jsx(n.code,{children:"Button"}),", ",e.jsx(n.code,{children:"IconButton"}),", ",e.jsx(n.code,{children:"Menu"}),`                                       |
| `,e.jsx(n.strong,{children:"Inputs"}),"       | ",e.jsx(n.code,{children:"Input"}),", ",e.jsx(n.code,{children:"Textarea"}),", ",e.jsx(n.code,{children:"Select"}),", ",e.jsx(n.code,{children:"Combobox"}),`                            |
| `,e.jsx(n.strong,{children:"Containers"}),"   | ",e.jsx(n.code,{children:"Card"}),", ",e.jsx(n.code,{children:"Panel"}),", ",e.jsx(n.code,{children:"Tabs"}),`                                              |
| `,e.jsx(n.strong,{children:"Data Display"})," | ",e.jsx(n.code,{children:"Badge"}),", ",e.jsx(n.code,{children:"DetailField"}),", ",e.jsx(n.code,{children:"HeroStats"}),", ",e.jsx(n.code,{children:"ProgressBar"}),", ",e.jsx(n.code,{children:"TagList"}),`        |
| `,e.jsx(n.strong,{children:"Overlays"}),"     | ",e.jsx(n.code,{children:"Modal"}),", ",e.jsx(n.code,{children:"Popover"}),", ",e.jsx(n.code,{children:"Tooltip"}),`                                        |
| `,e.jsx(n.strong,{children:"Feedback"}),"     | ",e.jsx(n.code,{children:"Spinner"}),", ",e.jsx(n.code,{children:"ThinkingDot"}),", ",e.jsx(n.code,{children:"EmptyState"}),", ",e.jsx(n.code,{children:"DataState"}),", ",e.jsx(n.code,{children:"ErrorBoundary"})," |"]}),`
`,e.jsxs(n.p,{children:["Every primitive carries ",e.jsx(n.code,{children:"autodocs"}),", so each entry has a generated ",e.jsx(n.strong,{children:"Docs"}),`
tab with prop tables alongside the hand-written stories.`]}),`
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
`,e.jsxs(n.li,{children:["Story title format is ",e.jsx(n.code,{children:"Primitives/<Bucket>/<Primitive>"}),` — match this when
you add a new one.`]}),`
`,e.jsx(n.li,{children:`Use real strings from the dashboard ("Create Quest", "Assign Agent") in
examples, not "Lorem ipsum".`}),`
`,e.jsxs(n.li,{children:[`Reach for tokens — never hardcode hex, radius, or transition values in a
story. Read the `,e.jsx(n.strong,{children:"Foundations → Design Language"})," page for the rules."]}),`
`]}),`
`,e.jsx(n.p,{children:"If a primitive ships in code without a story, the library is incomplete."})]})}function u(s={}){const{wrapper:n}={...r(),...s.components};return n?e.jsx(n,{...s,children:e.jsx(i,{...s})}):i(s)}export{u as default};
