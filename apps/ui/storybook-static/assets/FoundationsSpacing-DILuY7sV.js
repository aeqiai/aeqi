import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as o}from"./index-_tug67E6.js";import{M as d}from"./index-D11v2HJ2.js";import{r as t}from"./index-oxIuDU2I.js";import"./iframe-BIintNDS.js";import"./index-Dn0hWNo5.js";import"./_commonjsHelpers-CqkleIqs.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";const l=[{name:"--space-1",usage:"Tight gaps"},{name:"--space-2",usage:"Inline spacing"},{name:"--space-3",usage:"Compact padding"},{name:"--space-4",usage:"Standard padding"},{name:"--space-6",usage:"Panel padding"},{name:"--space-8",usage:"Page-level spacing"}];function p(s){const[n,i]=t.useState("");return t.useEffect(()=>{const c=getComputedStyle(document.documentElement).getPropertyValue(s).trim();i(c)},[s]),n}function h({token:s,usage:n}){const i=p(s);return e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"140px 1fr 180px",alignItems:"center",gap:16,padding:"8px 0"},children:[e.jsx("code",{style:{fontSize:12,color:"rgba(0,0,0,0.85)"},children:s}),e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:12},children:[e.jsx("span",{style:{display:"inline-block",height:10,width:i||0,background:"#0a0a0b",borderRadius:2}}),e.jsx("span",{style:{fontFamily:'"JetBrains Mono", monospace',fontSize:11,color:"rgba(0,0,0,0.45)"},children:i||"—"})]}),e.jsx("span",{style:{fontSize:12,color:"rgba(0,0,0,0.55)"},children:n})]})}function a(){return e.jsx("div",{style:{border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,padding:"16px 24px",background:"#ffffff",margin:"20px 0"},children:l.map(s=>e.jsx(h,{token:s.name,usage:s.usage},s.name))})}a.__docgenInfo={description:"",methods:[],displayName:"SpacingScale"};function r(s){const n={code:"code",h1:"h1",h2:"h2",li:"li",p:"p",strong:"strong",ul:"ul",...o(),...s.components};return e.jsxs(e.Fragment,{children:[e.jsx(d,{title:"Foundations/Spacing"}),`
`,e.jsx(n.h1,{id:"spacing",children:"Spacing"}),`
`,e.jsx(n.p,{children:`A single 4px-grid scale. Pick the closest step; do not introduce off-grid
values.`}),`
`,e.jsx(a,{}),`
`,e.jsx(n.h2,{id:"row-rhythm",children:"Row rhythm"}),`
`,e.jsxs(n.p,{children:["The app uses one canonical row height, ",e.jsx(n.code,{children:"--input-h"}),` (32px), for every
dense interactive surface: sidebar nav rows, inputs, buttons at `,e.jsx(n.code,{children:"md"}),`,
scope indicators. Buttons and inputs placed on the same row line up
without tweaks.`]}),`
`,e.jsx(n.p,{children:`The composer is taller (multi-line) but borrows the same border, radius,
and colors so it reads as a member of the same family.`}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["Use ",e.jsx(n.code,{children:"sm"})," size to feel denser."]}),`
`,e.jsxs(n.li,{children:["Use ",e.jsx(n.code,{children:"lg"})," size for hero and auth surfaces."]}),`
`,e.jsx(n.li,{children:"Do not introduce new row heights."}),`
`]}),`
`,e.jsx(n.h2,{id:"do--dont",children:"Do / don't"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"}),` nest spacing tokens the same way you nest layout. Panel padding
at `,e.jsx(n.code,{children:"--space-6"}),", inner form gaps at ",e.jsx(n.code,{children:"--space-4"}),`, inline gaps at
`,e.jsx(n.code,{children:"--space-2"}),"."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"})," reach for ",e.jsx(n.code,{children:"gap"})," + ",e.jsx(n.code,{children:"flex"}),"/",e.jsx(n.code,{children:"grid"})," before margin stacks."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't"}),` use pixel values directly. If the step you need isn't in the
scale, the design is fighting the system.`]}),`
`]})]})}function v(s={}){const{wrapper:n}={...o(),...s.components};return n?e.jsx(n,{...s,children:e.jsx(r,{...s})}):r(s)}export{v as default};
