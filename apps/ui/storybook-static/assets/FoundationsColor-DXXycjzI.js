import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as c}from"./index-_tug67E6.js";import{M as b}from"./index-CiKHI0Eo.js";import{r as s}from"./index-oxIuDU2I.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./_commonjsHelpers-CqkleIqs.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function m(o){const[n,a]=s.useState("");return s.useEffect(()=>{const t=getComputedStyle(document.documentElement).getPropertyValue(o).trim();a(t)},[o]),n}function g({swatch:o,variant:n}){const a=m(o.token),[t,l]=s.useState(!1);function d(){navigator.clipboard.writeText(o.token),l(!0),window.setTimeout(()=>l(!1),900)}const h=n==="ink"?"#ffffff":`var(${o.token})`,u="rgba(0,0,0,0.06)",p=n==="ink"?e.jsx("span",{style:{position:"absolute",inset:12,borderRadius:8,background:`var(${o.token})`}}):null;return e.jsxs("button",{type:"button",onClick:d,style:{display:"flex",flexDirection:"column",gap:10,padding:12,background:"#ffffff",border:"1px solid rgba(0,0,0,0.06)",borderRadius:10,cursor:"pointer",textAlign:"left",font:"inherit"},"aria-label":`Copy ${o.token}`,children:[e.jsx("span",{style:{position:"relative",height:72,borderRadius:8,background:h,border:`1px solid ${u}`,boxShadow:"inset 0 1px 0 rgba(255,255,255,0.4)",overflow:"hidden"},children:p}),e.jsxs("span",{style:{display:"flex",flexDirection:"column",gap:2},children:[e.jsx("span",{style:{fontFamily:'"JetBrains Mono", monospace',fontSize:11,color:"rgba(0,0,0,0.85)",wordBreak:"break-all"},children:o.token}),e.jsx("span",{style:{fontFamily:'"JetBrains Mono", monospace',fontSize:10.5,color:"rgba(0,0,0,0.45)",wordBreak:"break-all"},children:a||"—"}),o.label?e.jsx("span",{style:{fontSize:11.5,color:"rgba(0,0,0,0.62)",marginTop:4},children:o.label}):null,o.note?e.jsx("span",{style:{fontSize:10.5,color:"rgba(0,0,0,0.38)"},children:o.note}):null]}),e.jsx("span",{style:{marginTop:"auto",fontSize:10.5,color:t?"#2e8f71":"rgba(0,0,0,0.35)",letterSpacing:"0.04em",textTransform:"uppercase"},children:t?"copied":"click to copy"})]})}function r({swatches:o,variant:n="chroma",columns:a=4}){return e.jsx("div",{style:{display:"grid",gridTemplateColumns:`repeat(${a}, minmax(0, 1fr))`,gap:12,margin:"20px 0"},children:o.map(t=>e.jsx(g,{swatch:t,variant:n},t.token))})}r.__docgenInfo={description:"",methods:[],displayName:"ColorSwatchGrid",props:{swatches:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  token: string;
  label?: string;
  note?: string;
}`,signature:{properties:[{key:"token",value:{name:"string",required:!0}},{key:"label",value:{name:"string",required:!1}},{key:"note",value:{name:"string",required:!1}}]}}],raw:"Swatch[]"},description:""},variant:{required:!1,tsType:{name:"union",raw:'"chroma" | "ink"',elements:[{name:"literal",value:'"chroma"'},{name:"literal",value:'"ink"'}]},description:"",defaultValue:{value:'"chroma"',computed:!1}},columns:{required:!1,tsType:{name:"number"},description:"",defaultValue:{value:"4",computed:!1}}}};function i(o){const n={code:"code",h1:"h1",h2:"h2",h3:"h3",li:"li",p:"p",strong:"strong",ul:"ul",...c(),...o.components};return e.jsxs(e.Fragment,{children:[e.jsx(b,{title:"Foundations/Color"}),`
`,e.jsx(n.h1,{id:"color",children:"Color"}),`
`,e.jsxs(n.p,{children:["Click any swatch to copy its token. Values are read live from ",e.jsx(n.code,{children:":root"}),`, so
this page tracks `,e.jsx(n.code,{children:"packages/tokens/src/tokens.css"})," — never hardcode a hex."]}),`
`,e.jsx(n.h2,{id:"surfaces",children:"Surfaces"}),`
`,e.jsx(n.p,{children:`One shell, one white working paper, one ink sheet for inversion. The
two-step inset family lives inside the white card.`}),`
`,e.jsx(r,{swatches:[{token:"--color-shell",label:"App shell",note:"Authenticated outer frame"},{token:"--color-card",label:"Paper",note:"Primary reading surface"},{token:"--color-card-subtle",label:"Inset (subtle)",note:"Lighter well inside the card"},{token:"--color-card-muted",label:"Inset (strong)",note:"Stronger well inside the card"},{token:"--color-ink-card",label:"Ink sheet",note:"High-contrast moments only"}]}),`
`,e.jsx(n.h2,{id:"ink-text-and-borders",children:"Ink (text and borders)"}),`
`,e.jsx(n.p,{children:`A single near-black at varying opacities carries the full text hierarchy.
Do not add grey hues.`}),`
`,e.jsx(r,{variant:"ink",swatches:[{token:"--color-text-title",label:"Title (92%)",note:"Page titles, headings"},{token:"--color-text-primary",label:"Body (85%)",note:"Default body text"},{token:"--color-text-secondary",label:"Secondary (54%)",note:"Descriptions, labels"},{token:"--color-text-muted",label:"Muted (36%)",note:"Hints, eyebrows, timestamps"},{token:"--color-text-disabled",label:"Disabled (22%)",note:"Disabled text"},{token:"--color-border-faint",label:"Faint border (4%)",note:"Softest section divider"},{token:"--color-border",label:"Border (6%)",note:"Default hairline"},{token:"--color-border-hover",label:"Border (14%)",note:"Hover / active hairline"}]}),`
`,e.jsx(n.h2,{id:"accent",children:"Accent"}),`
`,e.jsx(n.p,{children:`The accent is near-black graphite. It owns the wordmark, primary CTAs,
links, focus rings, and active state. At ~2% surface area, it feels
authoritative. At more, it feels heavy.`}),`
`,e.jsx(r,{swatches:[{token:"--color-accent",label:"Accent",note:"CTAs, links, focus, wordmark"},{token:"--color-accent-hover",label:"Accent hover",note:"Hover state on CTAs"},{token:"--color-accent-dim",label:"Accent dim",note:"Mid-grey for marginalia"},{token:"--color-accent-bg",label:"Accent tint",note:"Selected rows, subtle highlights"}]}),`
`,e.jsx(n.h2,{id:"status",children:"Status"}),`
`,e.jsx(n.p,{children:`Status colors are the only chromatic exception outside the accent. They
appear minimally — a dot, a tint, subtle text color — never a full-bleed
wash.`}),`
`,e.jsx(r,{swatches:[{token:"--color-success",label:"Success",note:"Done, active, healthy (jade)"},{token:"--color-error",label:"Error",note:"Failed, validation errors (oxide red)"},{token:"--color-warning",label:"Warning",note:"Blocked, degraded (muted amber)"},{token:"--color-info",label:"Info",note:"In progress (inherits accent)"}]}),`
`,e.jsx(n.h3,{id:"status-backgrounds",children:"Status backgrounds"}),`
`,e.jsx(n.p,{children:`Tinted backgrounds for toast/banner/row emphasis. Pair with the matching
border token; never use a status foreground color on its own surface.`}),`
`,e.jsx(r,{swatches:[{token:"--color-success-bg",label:"Success bg"},{token:"--color-error-bg",label:"Error bg"},{token:"--color-warning-bg",label:"Warning bg"},{token:"--color-info-bg",label:"Info bg"}]}),`
`,e.jsx(n.h2,{id:"do--dont",children:"Do / don't"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"})," carry hierarchy with opacity on ink, not with new greys."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"})," reserve jade for success. Don't use it for decoration or brand."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Do"})," keep the accent at ~2% of pixel area. More reads as chrome."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't"}),` hardcode hex values in component CSS. Add a token to
`,e.jsx(n.code,{children:"@aeqi/tokens"})," first, then alias it in ",e.jsx(n.code,{children:"primitives.css"}),"."]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't"}),` use a status color as a full-bleed background. A dot or a 10%
tint is almost always enough.`]}),`
`]})]})}function T(o={}){const{wrapper:n}={...c(),...o.components};return n?e.jsx(n,{...o,children:e.jsx(i,{...o})}):i(o)}export{T as default};
