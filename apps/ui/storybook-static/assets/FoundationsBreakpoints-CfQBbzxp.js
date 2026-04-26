import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as i}from"./index-_tug67E6.js";import{M as o}from"./index-CiKHI0Eo.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function t(s){const n={code:"code",h1:"h1",h2:"h2",h3:"h3",hr:"hr",li:"li",p:"p",pre:"pre",strong:"strong",ul:"ul",...i(),...s.components};return e.jsxs(e.Fragment,{children:[e.jsx(o,{title:"Foundations/Breakpoints"}),`
`,e.jsx(n.h1,{id:"breakpoints",children:"Breakpoints"}),`
`,e.jsxs(n.p,{children:[`aeqi is designed desktop-first. Breakpoints exist for page layouts only — the
primitives themselves use flex and grid to stay fluid. The token system has
five breakpoints, but `,e.jsx(n.code,{children:"lg"})," is home base; the others earn their use."]}),`
`,e.jsx(n.h2,{id:"the-breakpoints",children:"The breakpoints"}),`
`,e.jsx(n.p,{children:`| Token    | Width  | Use case                                    |
| -------- | ------ | ------------------------------------------- |
| --bp-sm  | 640px  | Hand-held, one-hand reach (landscape phone) |
| --bp-md  | 768px  | Small tablet, split-pane laptop             |
| --bp-lg  | 1024px | Laptop default; the design's home base      |
| --bp-xl  | 1280px | Wide desktop, multi-rail dashboards         |
| --bp-2xl | 1536px | Ultra-wide; rarely needed                   |`}),`
`,e.jsx(n.h2,{id:"usage",children:"Usage"}),`
`,e.jsx(n.h3,{id:"page-layout-css",children:"Page layout CSS"}),`
`,e.jsx(n.p,{children:`Write media queries with the actual pixel value (CSS variables cannot be used
inside media query definitions in all browsers):`}),`
`,e.jsx(n.pre,{children:e.jsx(n.code,{className:"language-css",children:`@media (min-width: 768px) {
  .split-pane {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
`})}),`
`,e.jsxs(n.p,{children:["The CSS token is the source of truth. If you change ",e.jsx(n.code,{children:"--bp-md"})," in ",e.jsx(n.code,{children:"tokens.css"}),`,
the breakpoint updates everywhere it's used.`]}),`
`,e.jsx(n.h3,{id:"javascript-layouts",children:"JavaScript layouts"}),`
`,e.jsxs(n.p,{children:["For dynamic layouts, matchMedia, or window width checks, import from ",e.jsx(n.code,{children:"@aeqi/tokens"}),":"]}),`
`,e.jsx(n.pre,{children:e.jsx(n.code,{className:"language-ts",children:`import { breakpoint } from "@aeqi/tokens";

if (window.innerWidth >= parseInt(breakpoint.lg)) {
  // show multi-column layout
}
`})}),`
`,e.jsx(n.h2,{id:"dont",children:"Don't"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't add a sixth breakpoint"}),` without changing the design system. Five is
the contract. If a layout needs a unique threshold, that's a sign the layout
is wrong, not that the system needs another breakpoint.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't use breakpoints inside primitives."}),` Primitives must work at any
container width. Breakpoints belong on page layout layers only.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't pick px values ad-hoc in component CSS."}),` If a layout can't fit the
five breakpoints, work with design to adjust the layout, not to add a new
threshold.`]}),`
`]}),`
`,e.jsx(n.hr,{}),`
`,e.jsxs(n.p,{children:["Source: ",e.jsx(n.code,{children:"packages/tokens/src/tokens.css"})," and ",e.jsx(n.code,{children:"packages/tokens/src/tokens.ts"}),"."]})]})}function j(s={}){const{wrapper:n}={...i(),...s.components};return n?e.jsx(n,{...s,children:e.jsx(t,{...s})}):t(s)}export{j as default};
