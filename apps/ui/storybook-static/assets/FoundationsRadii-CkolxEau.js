import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as t}from"./index-_tug67E6.js";import{M as l}from"./index-D11v2HJ2.js";import{r as a}from"./index-oxIuDU2I.js";import"./iframe-BIintNDS.js";import"./index-Dn0hWNo5.js";import"./_commonjsHelpers-CqkleIqs.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";const c=[{name:"--radius-xs",usage:"Key pills, tight chips"},{name:"--radius-sm",usage:"Badges, tags"},{name:"--radius-md",usage:"Inputs, buttons"},{name:"--radius-lg",usage:"Panels, cards"},{name:"--radius-xl",usage:"Modals"},{name:"--radius-full",usage:"Pills, avatars"}];function u(n){const[s,i]=a.useState("");return a.useEffect(()=>{const d=getComputedStyle(document.documentElement).getPropertyValue(n).trim();i(d)},[n]),s}function m({token:n,usage:s}){const i=u(n);return e.jsxs("div",{style:{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:10},children:[e.jsx("div",{style:{width:80,height:80,background:"#0a0a0b",borderRadius:`var(${n})`}}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:2},children:[e.jsx("code",{style:{fontSize:12,color:"rgba(0,0,0,0.85)"},children:n}),e.jsx("span",{style:{fontFamily:'"JetBrains Mono", monospace',fontSize:11,color:"rgba(0,0,0,0.45)"},children:i||"—"}),e.jsx("span",{style:{fontSize:12,color:"rgba(0,0,0,0.55)",marginTop:2},children:s})]})]})}function o(){return e.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:20,padding:24,border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,background:"#ffffff",margin:"20px 0"},children:c.map(n=>e.jsx(m,{token:n.name,usage:n.usage},n.name))})}o.__docgenInfo={description:"",methods:[],displayName:"RadiusScale"};function r(n){const s={code:"code",h1:"h1",h2:"h2",li:"li",p:"p",strong:"strong",ul:"ul",...t(),...n.components};return e.jsxs(e.Fragment,{children:[e.jsx(l,{title:"Foundations/Radii"}),`
`,e.jsx(s.h1,{id:"radii",children:"Radii"}),`
`,e.jsx(s.p,{children:"Six steps. Radius maps to scale of surface, not to mood."}),`
`,e.jsx(o,{}),`
`,e.jsx(s.h2,{id:"mapping",children:"Mapping"}),`
`,e.jsxs(s.p,{children:[`| Surface          | Radius          |
| ---------------- | --------------- |
| Key pills, chips | `,e.jsx(s.code,{children:"--radius-xs"}),`   |
| Badges, tags     | `,e.jsx(s.code,{children:"--radius-sm"}),`   |
| Inputs, buttons  | `,e.jsx(s.code,{children:"--radius-md"}),`   |
| Panels, cards    | `,e.jsx(s.code,{children:"--radius-lg"}),`   |
| Modals           | `,e.jsx(s.code,{children:"--radius-xl"}),`   |
| Pills, avatars   | `,e.jsx(s.code,{children:"--radius-full"})," |"]}),`
`,e.jsx(s.h2,{id:"do--dont",children:"Do / don't"}),`
`,e.jsxs(s.ul,{children:[`
`,e.jsxs(s.li,{children:[e.jsx(s.strong,{children:"Do"}),` reach for a radius token, never a pixel value. If your surface
doesn't fit an existing step, the geometry is off — not the tokens.`]}),`
`,e.jsxs(s.li,{children:[e.jsx(s.strong,{children:"Don't"}),` round differently on different corners of a surface unless
the surface is anchored (sidebar joining a top bar, sheet docked to an
edge). Asymmetric radii are a composition signal, not a style choice.`]}),`
`]})]})}function S(n={}){const{wrapper:s}={...t(),...n.components};return s?e.jsx(s,{...n,children:e.jsx(r,{...n})}):r(n)}export{S as default};
