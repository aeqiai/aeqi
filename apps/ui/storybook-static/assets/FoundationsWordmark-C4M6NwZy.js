import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as t}from"./index-_tug67E6.js";import{M as o}from"./index-CiKHI0Eo.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function s(n){const r={code:"code",h1:"h1",h2:"h2",li:"li",p:"p",strong:"strong",ul:"ul",...t(),...n.components};return e.jsxs(e.Fragment,{children:[e.jsx(o,{title:"Foundations/Wordmark"}),`
`,e.jsx(r.h1,{id:"wordmark",children:"Wordmark"}),`
`,e.jsx("div",{style:{padding:"56px 0",textAlign:"center",background:"#ffffff",border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,margin:"20px 0"},children:e.jsx("span",{style:{fontFamily:"'Zen Dots', system-ui, sans-serif",fontSize:72,color:"#0a0a0b",letterSpacing:"0.02em"},children:e.jsx(r.p,{children:"æqi"})})}),`
`,e.jsxs(r.p,{children:["The ",e.jsx(r.strong,{children:"æqi"}),` wordmark, set in Zen Dots and rendered in graphite
(`,e.jsx(r.code,{children:"var(--color-accent)"}),`), is the brand mark. It appears as the product
name and never as decoration. Brand primitives (`,e.jsx(r.code,{children:"<Wordmark>"}),`,
`,e.jsx(r.code,{children:"<BrandMark>"}),") default to the accent — never pass a ",e.jsx(r.code,{children:"color"}),` override
unless the surface demands it.`]}),`
`,e.jsx(r.h2,{id:"rules",children:"Rules"}),`
`,e.jsxs(r.ul,{children:[`
`,e.jsxs(r.li,{children:["Always lowercase in prose: ",e.jsx(r.strong,{children:"æqi"}),`, never "AEQI" or "Aeqi" in UI text,
docs, or marketing copy.`]}),`
`,e.jsxs(r.li,{children:["The ",e.jsx(r.strong,{children:"æ"}),` ligature is reserved for the logo and brand references. In
running text inside the dashboard, "aeqi" is fine.`]}),`
`,e.jsx(r.li,{children:"Never add gradients, shadows, or effects. Never rotate or stretch."}),`
`,e.jsx(r.li,{children:"The accent owns the wordmark — nothing else competes."}),`
`]}),`
`,e.jsx(r.h2,{id:"clear-space",children:"Clear space"}),`
`,e.jsx(r.p,{children:`Keep a clear-space buffer around the wordmark equal to the height of the
lowercase "q" descender. Do not place chrome (icons, lines, other
lockups) inside that buffer.`}),`
`,e.jsx(r.h2,{id:"do--dont",children:"Do / don't"}),`
`,e.jsxs(r.ul,{children:[`
`,e.jsxs(r.li,{children:[e.jsx(r.strong,{children:"Do"})," use the wordmark once per screen — typically at the top-left."]}),`
`,e.jsxs(r.li,{children:[e.jsx(r.strong,{children:"Don't"}),` pair the wordmark with a tagline inside the dashboard. The
wordmark speaks for itself.`]}),`
`,e.jsxs(r.li,{children:[e.jsx(r.strong,{children:"Don't"}),` treat the wordmark as decoration. If a surface needs visual
weight, reach for a headline, not the mark.`]}),`
`]})]})}function f(n={}){const{wrapper:r}={...t(),...n.components};return r?e.jsx(r,{...n,children:e.jsx(s,{...n})}):s(n)}export{f as default};
