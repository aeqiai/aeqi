import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as r}from"./index-_tug67E6.js";import{M as o}from"./index-D11v2HJ2.js";import{E as a}from"./EmptyState-DfvOl-Bg.js";import{B as s}from"./Button-DVRBRNVW.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-BIintNDS.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function i(t){const n={code:"code",div:"div",h1:"h1",h2:"h2",li:"li",ol:"ol",p:"p",strong:"strong",ul:"ul",...r(),...t.components};return e.jsxs(e.Fragment,{children:[e.jsx(o,{title:"Patterns/Empty Dashboard"}),`
`,e.jsx(n.h1,{id:"empty-dashboard",children:"Empty Dashboard"}),`
`,e.jsx(n.p,{children:`The first-run state. A newly authenticated user has zero agents, zero
quests, zero events. The job of this pattern is to point at one next
action — not to showcase everything the product can do.`}),`
`,e.jsx(n.h2,{id:"live",children:"Live"}),`
`,e.jsx("div",{style:{minHeight:480,padding:40,background:"#f4f4f5",borderRadius:12,margin:"24px 0",display:"flex",alignItems:"center",justifyContent:"center"},children:e.jsx(a,{title:"No agents yet",description:"Create your first agent to start handing off work. An agent is a persona with instructions, memories, and a wallet — it runs quests on your behalf.",action:e.jsxs(n.div,{style:{display:"flex",gap:8},children:[e.jsx(s,{variant:"primary",children:"Create first agent"}),e.jsx(s,{variant:"ghost",children:"Read the docs"})]})})}),`
`,e.jsx(n.h2,{id:"anatomy",children:"Anatomy"}),`
`,e.jsxs(n.ol,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Title"}),` — one sentence. No emoji. State the condition, not the
feeling ("No agents yet" beats "Welcome!").`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Description"}),` — one sentence that explains what the missing thing
is and why the user would want one. Use the product's vocabulary
(agent, quest, idea, event) — not generic SaaS language.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Primary action"}),` — singular. The entire dashboard reduces to one
CTA. If there appear to be two equal actions, the empty state is
doing too much.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Secondary action"}),` — ghost button, reserved for docs or a demo.
Never a second creation path.`]}),`
`]}),`
`,e.jsx(n.h2,{id:"when-to-use",children:"When to use"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsx(n.li,{children:"First-run dashboards"}),`
`,e.jsx(n.li,{children:"Empty search results where a creation action is sensible"}),`
`,e.jsx(n.li,{children:"Zero-state panels inside a larger screen"}),`
`]}),`
`,e.jsx(n.h2,{id:"when-not-to-use",children:"When not to use"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["Mid-flight error states → use ",e.jsx(n.code,{children:"DataState"})," with an error slot."]}),`
`,e.jsxs(n.li,{children:[`Filtered-list-empty where the user can just clear a filter → use a
tighter inline message, not a full `,e.jsx(n.code,{children:"EmptyState"}),"."]}),`
`]}),`
`,e.jsx(n.h2,{id:"copy-rules",children:"Copy rules"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsx(n.li,{children:`Never "Oops!" or "Uh oh!" — the user hasn't done anything wrong.`}),`
`,e.jsx(n.li,{children:`Never "Welcome!" on an empty state — it's the dashboard, not the login
page.`}),`
`,e.jsx(n.li,{children:`Use sentence case. Period at the end of the description, no period on
the title.`}),`
`]})]})}function w(t={}){const{wrapper:n}={...r(),...t.components};return n?e.jsx(n,{...t,children:e.jsx(i,{...t})}):i(t)}export{w as default};
