import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as r}from"./index-_tug67E6.js";import{M as a}from"./index-CiKHI0Eo.js";import{B as l}from"./Badge-CRC_81sh.js";import{I as c}from"./IconButton-Xaaos3g3.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function i(t){const n={circle:"circle",code:"code",div:"div",h1:"h1",h2:"h2",li:"li",ol:"ol",p:"p",span:"span",strong:"strong",svg:"svg",ul:"ul",...r(),...t.components};return e.jsxs(e.Fragment,{children:[e.jsx(a,{title:"Patterns/Quest Row"}),`
`,e.jsx(n.h1,{id:"quest-row",children:"Quest Row"}),`
`,e.jsx(n.p,{children:`Dense list row for a quest queue. Reads left-to-right: status, title,
agent, timestamp, actions.`}),`
`,e.jsx(n.h2,{id:"live",children:"Live"}),`
`,e.jsx("div",{style:{border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,overflow:"hidden",background:"#ffffff",margin:"24px 0"},children:[{status:"in-progress",badge:"info",title:"Summarise the Q2 board pack",agent:"research-lead",time:"4m ago"},{status:"blocked",badge:"warning",title:"Resolve duplicate investor records",agent:"ops-janitor",time:"1h ago"},{status:"done",badge:"success",title:"Draft the Series A intro email",agent:"founder-voice",time:"Yesterday"}].map((s,o)=>e.jsxs(n.div,{style:{display:"grid",gridTemplateColumns:"140px 1fr 160px 120px auto",alignItems:"center",gap:16,padding:"14px 20px",borderTop:o===0?"none":"1px solid rgba(0,0,0,0.04)"},children:[e.jsx(l,{variant:s.badge,children:s.status}),e.jsx(n.span,{style:{fontSize:14,color:"rgba(0,0,0,0.85)"},children:s.title}),e.jsx(n.span,{style:{fontFamily:'"JetBrains Mono", monospace',fontSize:12,color:"rgba(0,0,0,0.55)"},children:s.agent}),e.jsx(n.span,{style:{fontSize:12,color:"rgba(0,0,0,0.4)",fontVariantNumeric:"tabular-nums"},children:s.time}),e.jsx(c,{"aria-label":"Row actions",variant:"ghost",size:"sm",children:e.jsxs(n.svg,{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",children:[e.jsx(n.circle,{cx:"3",cy:"7",r:"1.2",fill:"currentColor"}),e.jsx(n.circle,{cx:"7",cy:"7",r:"1.2",fill:"currentColor"}),e.jsx(n.circle,{cx:"11",cy:"7",r:"1.2",fill:"currentColor"})]})})]},s.title))}),`
`,e.jsx(n.h2,{id:"anatomy",children:"Anatomy"}),`
`,e.jsxs(n.ol,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Status badge"}),` — fixed-width column. Columns line up across the whole
list, so statuses scan vertically.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Title"}),` — single line, truncated on overflow. Never wrap to two
lines in a list row.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Agent"})," — mono so it reads as an identifier, not prose."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Timestamp"}),` — tabular-nums so digits line up; right-align if the
column is narrow.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Row actions"})," — one ",e.jsx(n.code,{children:"IconButton"}),` with an overflow menu, not an
inline action bar. Row actions are secondary; the row itself is the
primary action (click to open).`]}),`
`]}),`
`,e.jsx(n.h2,{id:"when-to-use",children:"When to use"}),`
`,e.jsx(n.p,{children:`Quest queues, event streams, agent activity lists — anywhere the user is
scanning to find one item among many.`}),`
`,e.jsx(n.h2,{id:"when-not-to-use",children:"When not to use"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["For 3–8 items with more than 2 data points each → use a ",e.jsx(n.strong,{children:"Card grid"}),`
(see Agent Card) so each item has room to breathe.`]}),`
`,e.jsxs(n.li,{children:[`For tabular data that needs sortable columns and filters → reach for a
real `,e.jsx(n.code,{children:"<table>"})," with column headers, not a row pattern."]}),`
`]})]})}function y(t={}){const{wrapper:n}={...r(),...t.components};return n?e.jsx(n,{...t,children:e.jsx(i,{...t})}):i(t)}export{y as default};
