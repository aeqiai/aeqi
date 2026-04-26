import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as a}from"./index-_tug67E6.js";import{M as o}from"./index-CiKHI0Eo.js";import{C as d}from"./Card-C85S5eq-.js";import{B as l}from"./Badge-CRC_81sh.js";import{D as i}from"./DetailField-DULnf8lh.js";import"./IconButton-Xaaos3g3.js";import{T as c}from"./TagList-CJ8UwDj8.js";import{B as t}from"./Button-DVRBRNVW.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function r(s){const n={code:"code",h1:"h1",h2:"h2",li:"li",ol:"ol",p:"p",strong:"strong",ul:"ul",...a(),...s.components};return e.jsxs(e.Fragment,{children:[e.jsx(o,{title:"Patterns/Agent Card"}),`
`,e.jsx(n.h1,{id:"agent-card",children:"Agent Card"}),`
`,e.jsxs(n.p,{children:[`Compact summary of an agent on the dashboard or in a grid view.
Composes `,e.jsx(n.code,{children:"Card"}),", ",e.jsx(n.code,{children:"Badge"}),", ",e.jsx(n.code,{children:"DetailField"}),", ",e.jsx(n.code,{children:"TagList"}),", ",e.jsx(n.code,{children:"IconButton"}),`, and
`,e.jsx(n.code,{children:"Button"}),"."]}),`
`,e.jsx(n.h2,{id:"live",children:"Live"}),`
`,e.jsx("div",{style:{maxWidth:420,margin:"24px 0"},children:e.jsxs(d,{variant:"default",padding:"md",children:[e.jsxs("div",{style:{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12},children:[e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:4},children:[e.jsx("span",{style:{fontFamily:'"JetBrains Mono", monospace',fontSize:11,color:"rgba(0,0,0,0.4)"},children:e.jsx(n.p,{children:"agent/research-lead"})}),e.jsx("span",{style:{fontSize:16,fontWeight:600,color:"rgba(0,0,0,0.9)"},children:e.jsx(n.p,{children:"Research Lead"})})]}),e.jsx(l,{variant:"success",children:"active"})]}),e.jsxs("div",{style:{marginTop:16,display:"grid",gap:10},children:[e.jsx(i,{label:"Parent",children:"orchestrator"}),e.jsx(i,{label:"Quests in flight",children:"3"}),e.jsx(i,{label:"Last event",children:"2 minutes ago"})]}),e.jsx("div",{style:{marginTop:16},children:e.jsx(c,{items:["research","summarisation","drafting"]})}),e.jsxs("div",{style:{marginTop:20,paddingTop:16,borderTop:"1px solid rgba(0,0,0,0.06)",display:"flex",gap:8},children:[e.jsx(t,{variant:"secondary",size:"sm",children:e.jsx(n.p,{children:"Open agent"})}),e.jsx(t,{variant:"ghost",size:"sm",children:e.jsx(n.p,{children:"Assign quest"})})]})]})}),`
`,e.jsx(n.h2,{id:"anatomy",children:"Anatomy"}),`
`,e.jsxs(n.ol,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Header row"})," — mono slug + human name on the left, status ",e.jsx(n.code,{children:"Badge"}),`
on the right.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Detail ladder"})," — three ",e.jsx(n.code,{children:"DetailField"}),` rows at most. More than three
and the card stops being a summary.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Tags"})," — ",e.jsx(n.code,{children:"TagList"})," for expertise signals. Keep to 3–5 tags."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Action bar"}),` — up to two actions, separated from the body by a
`,e.jsx(n.code,{children:"--space-4"})," gap and a hairline divider."]}),`
`]}),`
`,e.jsx(n.h2,{id:"when-to-use",children:"When to use"}),`
`,e.jsx(n.p,{children:`Dashboard grids. Agent pickers. Anywhere the user is scanning a set of
agents and needs to decide which one to open.`}),`
`,e.jsx(n.h2,{id:"when-not-to-use",children:"When not to use"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["For a single, focused agent view → use ",e.jsx(n.code,{children:"Panel"}),` with a full detail
layout instead.`]}),`
`,e.jsxs(n.li,{children:["For a list with >20 agents → rows (see ",e.jsx(n.strong,{children:"Patterns → Quest Row"}),`) scan
faster than cards.`]}),`
`]})]})}function M(s={}){const{wrapper:n}={...a(),...s.components};return n?e.jsx(n,{...s,children:e.jsx(r,{...s})}):r(s)}export{M as default};
