import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as s}from"./index-_tug67E6.js";import{M as a}from"./index-CiKHI0Eo.js";import{r as l}from"./index-oxIuDU2I.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./_commonjsHelpers-CqkleIqs.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";const d=[{token:"--transition-fast",label:"Fast",usage:"Hover, focus, state toggle"},{token:"--transition-normal",label:"Normal",usage:"Entrances, layout shifts"},{token:"--transition-slow",label:"Slow",usage:"Page-level reveal, hero"}];function i(){const[o,n]=l.useState(0);return e.jsxs("div",{style:{border:"1px solid rgba(0,0,0,0.06)",borderRadius:12,padding:24,background:"#ffffff",margin:"20px 0"},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:12,marginBottom:16},children:[e.jsx("button",{type:"button",onClick:()=>n(t=>t+1),style:{height:32,padding:"0 14px",borderRadius:6,border:"1px solid rgba(0,0,0,0.06)",background:"#0a0a0b",color:"#ffffff",fontSize:13,fontWeight:500,cursor:"pointer"},children:"Play"}),e.jsx("span",{style:{fontSize:12,color:"rgba(0,0,0,0.5)"},children:"Click to slide all three tracks. Compare cadence."})]}),e.jsx("div",{style:{display:"flex",flexDirection:"column",gap:16},children:d.map(t=>e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"160px 1fr 220px",alignItems:"center",gap:16},children:[e.jsx("code",{style:{fontSize:12,color:"rgba(0,0,0,0.85)"},children:t.token}),e.jsx("div",{style:{position:"relative",height:24,background:"#f4f4f5",borderRadius:12,overflow:"hidden"},children:e.jsx("span",{style:{position:"absolute",top:6,left:6,width:12,height:12,borderRadius:"50%",background:"#0a0a0b",animation:`motion-demo-slide var(${t.token}) forwards`}},o)}),e.jsx("span",{style:{fontSize:12,color:"rgba(0,0,0,0.55)"},children:t.usage})]},t.token))}),e.jsx("style",{children:`
        @keyframes motion-demo-slide {
          from { transform: translateX(0); }
          to   { transform: translateX(calc(100% + 100px)); }
        }
      `})]})}i.__docgenInfo={description:"",methods:[],displayName:"MotionDemo"};function r(o){const n={code:"code",h1:"h1",h2:"h2",li:"li",p:"p",strong:"strong",ul:"ul",...s(),...o.components};return e.jsxs(e.Fragment,{children:[e.jsx(a,{title:"Foundations/Motion"}),`
`,e.jsx(n.h1,{id:"motion",children:"Motion"}),`
`,e.jsx(n.p,{children:"Three cadences. No bouncy easing. Motion conveys continuity, not delight."}),`
`,e.jsx(i,{}),`
`,e.jsx(n.h2,{id:"when-to-use-which",children:"When to use which"}),`
`,e.jsxs(n.p,{children:[`| Token                 | Cadence                            | Use for                             |
| --------------------- | ---------------------------------- | ----------------------------------- |
| `,e.jsx(n.code,{children:"--transition-fast"}),`   | 150ms ease                         | Hover, focus, toggle, state change  |
| `,e.jsx(n.code,{children:"--transition-normal"}),` | 200ms cubic-bezier(0.4, 0, 0.2, 1) | Entrances, layout shifts, popovers  |
| `,e.jsx(n.code,{children:"--transition-slow"}),"   | 500ms cubic-bezier(0.4, 0, 0.2, 1) | Page-level reveal, hero, onboarding |"]}),`
`,e.jsx(n.h2,{id:"do--dont",children:"Do / don't"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"})," transition the specific property that changes (",e.jsx(n.code,{children:"opacity"}),`,
`,e.jsx(n.code,{children:"transform"}),", ",e.jsx(n.code,{children:"background"}),") — never ",e.jsx(n.code,{children:"all"}),"."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"})," respect ",e.jsx(n.code,{children:"prefers-reduced-motion"}),`. For anything above a fade,
drop the transform and keep the opacity.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't"}),` add a bounce or overshoot. aeqi motion is steady, not
performative.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't"}),` chain more than two transitions on the same element; the
cadence gets muddy.`]}),`
`]})]})}function y(o={}){const{wrapper:n}={...s(),...o.components};return n?e.jsx(n,{...o,children:e.jsx(r,{...o})}):r(o)}export{y as default};
