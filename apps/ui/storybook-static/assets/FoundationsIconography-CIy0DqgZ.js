import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as i}from"./index-_tug67E6.js";import{M as t}from"./index-CiKHI0Eo.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-COFHAseq.js";import"./index-Dn0hWNo5.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function s(o){const n={code:"code",h1:"h1",h2:"h2",hr:"hr",li:"li",p:"p",strong:"strong",ul:"ul",...i(),...o.components};return e.jsxs(e.Fragment,{children:[e.jsx(t,{title:"Foundations/Iconography"}),`
`,e.jsx(n.h1,{id:"iconography",children:"Iconography"}),`
`,e.jsxs(n.p,{children:[`lucide-react is the canonical icon source. Every icon in the product comes from
that library. Stroke weight is 1.5 — consistent, mechanical, precision-instrument
quality. Color is always `,e.jsx(n.code,{children:"currentColor"}),`: icons are ink, not decoration, and they
follow their parent's text color without a separate prop.`]}),`
`,e.jsx(n.h2,{id:"size-scale",children:"Size scale"}),`
`,e.jsx(n.p,{children:`Icons participate in the same 4px rhythm as every other element. Four sizes cover
every context — choose the one that matches the row height it sits in.`}),`
`,e.jsxs(n.p,{children:[`| Token | px  | Typical use                                              |
| ----- | --- | -------------------------------------------------------- |
| `,e.jsx(n.code,{children:"xs"}),`  | 12  | Monospace labels, badge decorations, tight inline counts |
| `,e.jsx(n.code,{children:"sm"}),"  | 14  | Dense rows, ",e.jsx(n.code,{children:"--input-h"}),` (32px) surfaces, toolbar slots   |
| `,e.jsx(n.code,{children:"md"}),`  | 16  | Default. Card headers, form field prefixes, nav rail     |
| `,e.jsx(n.code,{children:"lg"}),"  | 20  | Page headings, empty-state illustrations, modal titles   |"]}),`
`,e.jsx(n.h2,{id:"rules",children:"Rules"}),`
`,e.jsxs(n.p,{children:[e.jsxs(n.strong,{children:["Always use ",e.jsx(n.code,{children:"<Icon icon={Plus} />"})]})," — never drop a raw ",e.jsx(n.code,{children:"<svg>"}),` into feature code.
The primitive controls stroke weight, size scale, and accessibility in one place.
Raw SVGs bypass all three.`]}),`
`,e.jsxs(n.p,{children:[e.jsx(n.strong,{children:"Decorative by default."}),` An icon next to a label that already names its purpose
is decorative: set nothing, `,e.jsx(n.code,{children:'aria-hidden="true"'}),` is applied for you. If the icon
carries meaning that does not also appear in adjacent text — a standalone close
button, an action only conveyed through shape — set `,e.jsx(n.code,{children:"decorative={false}"}),` and
supply a `,e.jsx(n.code,{children:"label"}),". The component warns to console in development if you forget."]}),`
`,e.jsxs(n.p,{children:[e.jsxs(n.strong,{children:["Icons inherit color from their parent via ",e.jsx(n.code,{children:"currentColor"}),"."]}),` Change the ink on the
containing element, not the icon. Never pass a color token directly to `,e.jsx(n.code,{children:"<Icon>"}),`.
The icon sits in the typographic flow and should read as part of the text, not as
a colored object.`]}),`
`,e.jsxs(n.p,{children:[e.jsx(n.strong,{children:"Pair size with row height."})," ",e.jsx(n.code,{children:"sm"})," icons (14px) belong in ",e.jsx(n.code,{children:"--input-h"}),` (32px) rows.
`,e.jsx(n.code,{children:"md"})," icons (16px) belong in card headers and section anchors. ",e.jsx(n.code,{children:"lg"}),` icons (20px)
are for moments of visual emphasis — empty states, modal titles — not inline body
content.`]}),`
`,e.jsx(n.h2,{id:"dont",children:"Don't"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsxs(n.strong,{children:["Don't change ",e.jsx(n.code,{children:"strokeWidth"})," per-instance."]}),` If 1.5 needs revisiting, change it
in the design system. Per-instance overrides fragment the visual language across
the product.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't fill icons with a color."})," Lucide icons are stroke-based. Applying ",e.jsx(n.code,{children:"fill"}),`
produces a solid silhouette that reads as a different iconographic register.`]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Don't import the full lucide bundle."}),` Always use explicit named imports:
`,e.jsx(n.code,{children:'import { Plus } from "lucide-react"'}),`. Tree-shaking depends on it; a wildcard
import bloats every page.`]}),`
`]}),`
`,e.jsx(n.hr,{}),`
`,e.jsxs(n.p,{children:["See ",e.jsx(n.code,{children:"Primitives/Data Display/Icon"}),` for the interactive story with all common icons,
size scale, and accessibility examples.`]})]})}function j(o={}){const{wrapper:n}={...i(),...o.components};return n?e.jsx(n,{...o,children:e.jsx(s,{...o})}):s(o)}export{j as default};
