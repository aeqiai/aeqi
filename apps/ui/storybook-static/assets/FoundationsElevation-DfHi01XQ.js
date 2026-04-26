import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as i}from"./index-_tug67E6.js";import{M as t}from"./index-CiKHI0Eo.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function s(){return e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:24,padding:32,background:"#f4f4f5",borderRadius:12,margin:"20px 0"},children:[e.jsxs("figure",{style:{margin:0},children:[e.jsx("div",{style:{height:120,borderRadius:12,background:"#ffffff",boxShadow:"var(--card-elevation)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"rgba(0,0,0,0.62)"},children:"--card-elevation"}),e.jsx("figcaption",{style:{marginTop:10,fontSize:12,color:"rgba(0,0,0,0.55)"},children:"Canonical lifted card. Use for content sheets, modals, popovers."})]}),e.jsxs("figure",{style:{margin:0},children:[e.jsx("div",{style:{height:120,borderRadius:12,background:"#ffffff",border:"1px solid rgba(0,0,0,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"rgba(0,0,0,0.62)"},children:"hairline only"}),e.jsx("figcaption",{style:{marginTop:10,fontSize:12,color:"rgba(0,0,0,0.55)"},children:"Flat surface. Default for inline panels and in-document cards."})]}),e.jsxs("figure",{style:{margin:0},children:[e.jsx("div",{style:{height:120,borderRadius:12,background:"#ffffff",boxShadow:"0 12px 28px rgba(0,0,0,0.18)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"rgba(0,0,0,0.62)"},children:"heavy drop shadow"}),e.jsx("figcaption",{style:{marginTop:10,fontSize:12,color:"rgba(184, 92, 92, 0.85)"},children:"Don't. Reads as generic SaaS. Not part of the system."})]})]})}s.__docgenInfo={description:"",methods:[],displayName:"ElevationDemo"};function o(r){const n={code:"code",h1:"h1",h2:"h2",li:"li",p:"p",pre:"pre",strong:"strong",ul:"ul",...i(),...r.components};return e.jsxs(e.Fragment,{children:[e.jsx(t,{title:"Foundations/Elevation"}),`
`,e.jsx(n.h1,{id:"elevation",children:"Elevation"}),`
`,e.jsxs(n.p,{children:[`A single canonical treatment for lifted white cards. Composes a 1px
hairline ring (inset via `,e.jsx(n.code,{children:"box-shadow"}),` — no layout cost) with a whisper of
ambient shadow and a long-range soft shadow.`]}),`
`,e.jsx(n.p,{children:`The sheet separates from the tinted frame without any of the drop-shadow
heaviness that reads as "AI wrapper."`}),`
`,e.jsx(s,{}),`
`,e.jsx(n.h2,{id:"usage",children:"Usage"}),`
`,e.jsx(n.pre,{children:e.jsx(n.code,{className:"language-css",children:`.sheet {
  background: var(--color-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-elevation);
}
`})}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["Pair ",e.jsx(n.code,{children:"--card-elevation"})," with ",e.jsx(n.code,{children:"--radius-lg"})," and ",e.jsx(n.code,{children:"--color-card"}),"."]}),`
`,e.jsxs(n.li,{children:["Do ",e.jsx(n.strong,{children:"not"})," combine with ",e.jsx(n.code,{children:"--shadow-md"}),", ",e.jsx(n.code,{children:"--shadow-lg"}),`, or custom drop
shadows. The token already carries its own depth.`]}),`
`,e.jsxs(n.li,{children:["The inline ",e.jsx(n.code,{children:"--shadow-popover"})," / ",e.jsx(n.code,{children:"--shadow-glow"}),` tokens are for floating
surfaces (popovers, pickers). Lifted cards use `,e.jsx(n.code,{children:"--card-elevation"}),"."]}),`
`]}),`
`,e.jsx(n.h2,{id:"do--dont",children:"Do / don't"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"})," use elevation to separate a working sheet from its tinted frame."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"}),` keep the hairline ring; it reads crisp on both light and dark
backgrounds.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't"}),` stack two elevation tokens on the same surface. If the card
needs more weight, reach for contrast, not for bigger shadows.`]}),`
`]})]})}function j(r={}){const{wrapper:n}={...i(),...r.components};return n?e.jsx(n,{...r,children:e.jsx(o,{...r})}):o(r)}export{j as default};
