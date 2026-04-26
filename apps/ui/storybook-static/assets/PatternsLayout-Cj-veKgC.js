import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as t}from"./index-_tug67E6.js";import{M as l}from"./index-CiKHI0Eo.js";import{S as c}from"./Stack-DcCu8G-b.js";import{I as r}from"./Inline-BcwiYuLf.js";import{B as o}from"./Button-DVRBRNVW.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function d(i){const n={blockquote:"blockquote",code:"code",div:"div",h1:"h1",h2:"h2",h3:"h3",li:"li",p:"p",span:"span",strong:"strong",ul:"ul",...t(),...i.components};return e.jsxs(e.Fragment,{children:[e.jsx(l,{title:"Patterns/Layout"}),`
`,e.jsx(n.h1,{id:"layout",children:"Layout"}),`
`,e.jsxs(n.p,{children:[e.jsx(n.code,{children:"<Stack>"})," and ",e.jsx(n.code,{children:"<Inline>"}),` are the canonical replacements for the
`,e.jsx(n.code,{children:"style={{ display: 'flex', gap: ... }}"}),` pattern scattered across the
codebase. They keep token values in CSS, keep props out of component
bodies, and give the type system a contract: gap values are always a
valid `,e.jsx(n.code,{children:"--space-N"})," token, never an ad-hoc pixel count."]}),`
`,e.jsx(n.h2,{id:"when-to-use",children:"When to use"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Page layouts"})," — a main content area stacked top to bottom."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Card internals"})," — header, body, and footer as a ",e.jsx(n.code,{children:'<Stack gap="4">'}),"."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Toolbars"})," — action groups in an ",e.jsx(n.code,{children:'<Inline justify="between">'}),"."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Form sections"})," — label + input pairs stacked with ",e.jsx(n.code,{children:'<Stack gap="1">'}),`,
the whole form with `,e.jsx(n.code,{children:'<Stack gap="4">'}),"."]}),`
`]}),`
`,e.jsx(n.h2,{id:"when-not-to-use",children:"When not to use"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Inside a primitive's own CSS Module."}),` A component that is
fundamentally a row — `,e.jsx(n.code,{children:"Tabs"}),", ",e.jsx(n.code,{children:"IconButton"}),", ",e.jsx(n.code,{children:"Badge"}),` — already owns its
flex layout in its `,e.jsx(n.code,{children:".module.css"}),". Reaching for ",e.jsx(n.code,{children:"<Inline>"}),` inside that
component is a layering violation: the primitive should be the source of
truth for its own geometry.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"One-off micro-spacing inside a component you're already styling."}),`
If you're in a `,e.jsx(n.code,{children:"DetailField.module.css"}),` and need two items 4 px apart,
use `,e.jsx(n.code,{children:"var(--space-1)"}),` directly in that file. Don't import a layout
primitive to fix a single interior gap.`]}),`
`]}),`
`,e.jsx(n.h2,{id:"examples",children:"Examples"}),`
`,e.jsx(n.h3,{id:"1--form-actions-row",children:"1 — Form actions row"}),`
`,e.jsxs(n.p,{children:[e.jsx(n.code,{children:'<Inline justify="end" gap="2">'}),` pushes the action group to the trailing
edge of its container. Cancel lands left of Submit because DOM order is
preserved.`]}),`
`,e.jsx("div",{style:{maxWidth:480,padding:"24px",border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,background:"#ffffff",margin:"24px 0"},children:e.jsxs(r,{justify:"end",gap:"2",children:[e.jsx(o,{variant:"ghost",children:"Cancel"}),e.jsx(o,{variant:"primary",children:"Submit"})]})}),`
`,e.jsx(n.h3,{id:"2--card-header",children:"2 — Card header"}),`
`,e.jsxs(n.p,{children:[e.jsx(n.code,{children:'<Inline justify="between" align="center">'}),` puts the title on the left
and the badge on the right without any spacer divs or margin hacks.`]}),`
`,e.jsx("div",{style:{maxWidth:420,padding:"16px 20px",border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,background:"#ffffff",margin:"24px 0"},children:e.jsxs(r,{justify:"between",align:"center",children:[e.jsx("span",{style:{fontSize:15,fontWeight:600,color:"rgba(10,10,11,0.92)"},children:e.jsx(n.p,{children:"Research Lead"})}),e.jsx("span",{style:{padding:"3px 8px",fontSize:12,fontWeight:500,color:"#2e8f71",background:"rgba(46,143,113,0.1)",border:"1px solid rgba(46,143,113,0.22)",borderRadius:999},children:e.jsx(n.p,{children:"active"})})]})}),`
`,e.jsx(n.h3,{id:"3--detail-ladder",children:"3 — Detail ladder"}),`
`,e.jsxs(n.p,{children:[e.jsx(n.code,{children:'<Stack gap="2">'}),` creates an evenly-spaced column of label-value pairs.
Each row is itself an `,e.jsx(n.code,{children:"<Inline>"})," if the label and value sit side by side."]}),`
`,e.jsx("div",{style:{maxWidth:420,padding:"20px 24px",border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,background:"#ffffff",margin:"24px 0"},children:e.jsx(c,{gap:"2",children:[{label:"Parent",value:"orchestrator"},{label:"Quests in flight",value:"3"},{label:"Last event",value:"2 minutes ago"}].map(({label:s,value:a})=>e.jsxs(n.div,{style:{display:"flex",justifyContent:"space-between",alignItems:"center"},children:[e.jsx(n.span,{style:{fontSize:13,color:"rgba(10,10,11,0.54)"},children:s}),e.jsx(n.span,{style:{fontSize:13,fontFamily:'"JetBrains Mono", monospace',color:"rgba(10,10,11,0.85)"},children:a})]},s))})}),`
`,e.jsx(n.h2,{id:"token-mapping",children:"Token mapping"}),`
`,e.jsxs(n.p,{children:["The ",e.jsx(n.code,{children:"gap"}),` prop is a key into the spacing scale. Values outside this table
are a type error.`]}),`
`,e.jsxs(n.p,{children:["| ",e.jsx(n.code,{children:"gap"}),` prop | CSS token    | Computed value |
| ---------- | ------------ | -------------- |
| `,e.jsx(n.code,{children:'"0"'}),"      | ",e.jsx(n.code,{children:"--space-0"}),`  | 2px            |
| `,e.jsx(n.code,{children:'"1"'}),"      | ",e.jsx(n.code,{children:"--space-1"}),`  | 4px            |
| `,e.jsx(n.code,{children:'"2"'}),"      | ",e.jsx(n.code,{children:"--space-2"}),`  | 8px            |
| `,e.jsx(n.code,{children:'"3"'}),"      | ",e.jsx(n.code,{children:"--space-3"}),`  | 12px           |
| `,e.jsx(n.code,{children:'"4"'}),"      | ",e.jsx(n.code,{children:"--space-4"}),`  | 16px           |
| `,e.jsx(n.code,{children:'"5"'}),"      | ",e.jsx(n.code,{children:"--space-5"}),`  | 20px           |
| `,e.jsx(n.code,{children:'"6"'}),"      | ",e.jsx(n.code,{children:"--space-6"}),`  | 24px           |
| `,e.jsx(n.code,{children:'"8"'}),"      | ",e.jsx(n.code,{children:"--space-8"}),"  | 32px           |"]}),`
`,e.jsxs(n.blockquote,{children:[`
`,e.jsxs(n.p,{children:["The scale skips ",e.jsx(n.code,{children:"7"})," because ",e.jsx(n.code,{children:"--space-7"})," is not defined in ",e.jsx(n.code,{children:"tokens.css"}),`.
The 4 px grid jumps from 24 px to 32 px at the large end — use `,e.jsx(n.code,{children:'"6"'}),` for
section breathing room, `,e.jsx(n.code,{children:'"8"'})," for page-level separation."]}),`
`]}),`
`,e.jsx(n.h2,{id:"see-also",children:"See also"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Primitives → Containers → Stack"})," — vertical flex, full API and all variants."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Primitives → Containers → Inline"})," — horizontal flex, full API and all variants."]}),`
`]})]})}function w(i={}){const{wrapper:n}={...t(),...i.components};return n?e.jsx(n,{...i,children:e.jsx(d,{...i})}):d(i)}export{w as default};
