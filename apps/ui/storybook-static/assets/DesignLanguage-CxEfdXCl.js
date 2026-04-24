import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{useMDXComponents as a}from"./index-_tug67E6.js";import{M as u}from"./index-C5DnYz3G.js";import{r as i}from"./index-oxIuDU2I.js";import"./iframe-CnJ9QsOX.js";import"./index-Dn0hWNo5.js";import"./_commonjsHelpers-CqkleIqs.js";import"./index-ChhEEol8.js";import"./index-DgH-xKnr.js";import"./index-DrFu-skq.js";function r({name:s,fallback:n=""}){const[c,l]=i.useState(n);return i.useEffect(()=>{const h=getComputedStyle(document.documentElement).getPropertyValue(s).trim();l(h||n)},[s,n]),e.jsx(e.Fragment,{children:c})}r.__docgenInfo={description:"Reads the live value of a CSS custom property from :root and displays it.\nUsed by the design-language docs so every value on the page tracks the\ntoken file: change `--color-accent` in `tokens.css` and every label on\nthe design-language page updates on next paint. No hardcoded hex.",methods:[],displayName:"TokenValue",props:{name:{required:!0,tsType:{name:"string"},description:""},fallback:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'""',computed:!1}}}};function t({rows:s}){return e.jsxs("table",{children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{children:"Token"}),e.jsx("th",{children:"Value"}),e.jsx("th",{children:"Usage"})]})}),e.jsx("tbody",{children:s.map(n=>e.jsxs("tr",{children:[e.jsx("td",{children:e.jsx("code",{children:n.token})}),e.jsx("td",{children:e.jsx("code",{children:e.jsx(r,{name:n.token,fallback:n.fallback})})}),e.jsx("td",{children:n.usage})]},n.token))})]})}function d({rows:s}){return e.jsxs("table",{children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{children:"Status"}),e.jsx("th",{children:"Color"}),e.jsx("th",{children:"Token"}),e.jsx("th",{children:"Used for"})]})}),e.jsx("tbody",{children:s.map(n=>e.jsxs("tr",{children:[e.jsx("td",{children:n.status}),e.jsxs("td",{children:[e.jsx("span",{style:{display:"inline-block",width:10,height:10,borderRadius:"50%",background:`var(${n.token})`,marginRight:8,verticalAlign:"middle"}}),e.jsx("code",{children:e.jsx(r,{name:n.token,fallback:n.fallback})})]}),e.jsx("td",{children:e.jsx("code",{children:n.token})}),e.jsx("td",{children:n.usage})]},n.token))})]})}t.__docgenInfo={description:"Renders a token table with live values read from the DOM. Used by the\ndesign-language MDX so token docs can never drift from `tokens.css`.\nChange a token → this table updates on next paint.",methods:[],displayName:"TokenTable",props:{rows:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  token: string;
  usage: React.ReactNode;
  fallback?: string;
}`,signature:{properties:[{key:"token",value:{name:"string",required:!0}},{key:"usage",value:{name:"ReactReactNode",raw:"React.ReactNode",required:!0}},{key:"fallback",value:{name:"string",required:!1}}]}}],raw:"Row[]"},description:""}}};d.__docgenInfo={description:'Status-colors variant with a leading "Status" column and a swatch dot.',methods:[],displayName:"StatusTokenTable",props:{rows:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:"{ status: string; token: string; usage: React.ReactNode; fallback?: string }",signature:{properties:[{key:"status",value:{name:"string",required:!0}},{key:"token",value:{name:"string",required:!0}},{key:"usage",value:{name:"ReactReactNode",raw:"React.ReactNode",required:!0}},{key:"fallback",value:{name:"string",required:!1}}]}}],raw:"{ status: string; token: string; usage: React.ReactNode; fallback?: string }[]"},description:""}}};function o(s){const n={blockquote:"blockquote",code:"code",h1:"h1",h2:"h2",h3:"h3",hr:"hr",li:"li",ol:"ol",p:"p",strong:"strong",ul:"ul",...a(),...s.components};return e.jsxs(e.Fragment,{children:[e.jsx(u,{title:"Foundations/Design Language"}),`
`,e.jsx(n.h1,{id:"aeqi-design-language",children:"aeqi design language"}),`
`,e.jsxs(n.blockquote,{children:[`
`,e.jsxs(n.p,{children:[e.jsx(n.strong,{children:"v4 — Graphite + Ink."}),` The aeqi design system is built on restraint.
Every element earns its place through function, not decoration. The interface
recedes so the four primitives — Agents, Events, Quests, Ideas — can speak clearly.`]}),`
`]}),`
`,e.jsxs(n.blockquote,{children:[`
`,e.jsxs(n.p,{children:["Every value in the tables below is read live from ",e.jsx(n.code,{children:":root"})," via ",e.jsx(n.code,{children:"getComputedStyle"}),`.
There is no hardcoded hex on this page — edit `,e.jsx(n.code,{children:"@aeqi/tokens"})," or ",e.jsx(n.code,{children:"primitives.css"}),`
and this doc updates automatically.`]}),`
`]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"principles",children:"Principles"}),`
`,e.jsx(n.h3,{id:"restraint-with-one-accent",children:"Restraint, with one accent"}),`
`,e.jsx(n.p,{children:`Pure neutral paper, ink at opacity, one near-black graphite accent. The accent
earns its weight by scarcity: wordmark, primary CTA, links, focus, active state.
Titles stay ink. The system is restrained, not monochrome.`}),`
`,e.jsx(n.p,{children:e.jsx(n.strong,{children:"Ratio rule — hold these or it goes generic:"})}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsx(n.li,{children:"~70% neutral grey paper + white card surfaces"}),`
`,e.jsx(n.li,{children:"~28% ink body copy (black at 22–92% alpha)"}),`
`,e.jsx(n.li,{children:"~2% near-black graphite accent (CTAs, active nav, focus, selected, wordmark)"}),`
`]}),`
`,e.jsxs(n.p,{children:["Jade is reserved for the ",e.jsx(n.strong,{children:"success"}),` semantic (completed quests, resolved
events) so brand and status signal read visually distinct.`]}),`
`,e.jsx(n.h3,{id:"opacity-as-depth",children:"Opacity as depth"}),`
`,e.jsx(n.p,{children:"A single black at varying opacities carries hierarchy inside the ink system:"}),`
`,e.jsx(t,{rows:[{token:"--color-text-title",usage:"Titles, mastheads (90%)"},{token:"--color-text-primary",usage:"Body text (85%)"},{token:"--color-text-secondary",usage:"Labels, descriptions (45%)"},{token:"--color-text-muted",usage:"Hints, timestamps (25%)"},{token:"--color-border",usage:"Panel borders, dividers"},{token:"--color-divider",usage:"Softer section breaks inside content"}]}),`
`,e.jsx(n.h3,{id:"surfaces--shell-paper-inset",children:"Surfaces — shell, paper, inset"}),`
`,e.jsx(n.p,{children:`The authenticated app uses one shell surface, one white working paper, and a
two-step inset family inside that paper:`}),`
`,e.jsx(t,{rows:[{token:"--color-shell",usage:"Authenticated app shell / outer frame (#f4f4f5)"},{token:"--color-card",usage:"Primary paper / main reading surface (#ffffff)"},{token:"--color-card-subtle",usage:"Light inset inside the white card (#f8f8f9, lighter than shell)"},{token:"--color-card-muted",usage:"Strong inset inside the white card (#ededf0, darker than shell)"},{token:"--color-ink-card",usage:"Inverse surface for rare high-contrast moments (#0a0a0b)"}]}),`
`,e.jsx(n.h3,{id:"precision-over-decoration",children:"Precision over decoration"}),`
`,e.jsx(n.p,{children:`No gratuitous gradients, heavy shadows, or extravagant rounding. Components use
sharp geometry and minimal chrome. Status color (success, error, warning, info)
appears sparingly — a dot, a tint — never a full-bleed wash.`}),`
`,e.jsx(n.h3,{id:"the-four-primitives",children:"The four primitives"}),`
`,e.jsx(n.p,{children:"Everything in aeqi maps to one of four primitives:"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Agents"})," — autonomous entities with parent-child hierarchy (WHO)"]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Events"})," — triggers and audit stream (WHEN)"]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Quests"})," — work items agents pursue (WHAT)"]}),`
`,e.jsxs(n.li,{children:[e.jsx(n.strong,{children:"Ideas"})," — knowledge, identity, instructions, memories (HOW)"]}),`
`]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"the-æqi-wordmark",children:"The æqi wordmark"}),`
`,e.jsxs(n.p,{children:["The ",e.jsx(n.strong,{children:"æqi"}),` wordmark, set in Zen Dots and rendered in graphite
(`,e.jsx(n.code,{children:"var(--color-accent)"}),`), is the brand mark. It appears as the product name and
never as decoration. Brand primitives (`,e.jsx(n.code,{children:"<Wordmark>"}),", ",e.jsx(n.code,{children:"<BrandMark>"}),`) default to
the accent — never pass a `,e.jsx(n.code,{children:"color"})," override unless the surface demands it."]}),`
`,e.jsx(n.p,{children:"Usage rules:"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:["Always lowercase: ",e.jsx(n.strong,{children:"æqi"}),', never "AEQI" or "Aeqi" in UI text']}),`
`,e.jsx(n.li,{children:'The "æ" ligature is reserved for the logo and brand references'}),`
`,e.jsx(n.li,{children:"Never add gradients, shadows, or effects; never rotate or stretch"}),`
`,e.jsx(n.li,{children:"The accent owns the wordmark — nothing else competes"}),`
`]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"typography",children:"Typography"}),`
`,e.jsx(n.p,{children:"Four typefaces with single, non-overlapping roles. Do not introduce more."}),`
`,e.jsx(t,{rows:[{token:"--font-sans",usage:"Inter — UI chrome: labels, body, headings"},{token:"--font-mono",usage:"JetBrains Mono — code, IDs, model names, technical values"},{token:"--font-display",usage:"Exo 2 — page titles, hero, marquee moments (geometric sci-fi sans)"},{token:"--font-brand",usage:"Zen Dots — the æqi wordmark only"}]}),`
`,e.jsx(n.h3,{id:"type-scale",children:"Type scale"}),`
`,e.jsx(t,{rows:[{token:"--font-size-3xs",usage:"Micro labels"},{token:"--font-size-2xs",usage:"Eyebrow caps"},{token:"--font-size-xs",usage:"Badges, timestamps, metadata"},{token:"--font-size-sm",usage:"Secondary text, descriptions"},{token:"--font-size-base",usage:"Body text, form labels"},{token:"--font-size-lg",usage:"Base / root size"},{token:"--font-size-xl",usage:"Section headings"},{token:"--font-size-2xl",usage:"Page titles"},{token:"--font-size-3xl",usage:"Hero headlines"},{token:"--font-size-4xl",usage:"Display"}]}),`
`,e.jsx(n.p,{children:`Weights: 400 (regular), 500 (medium for labels), 600 (semibold for headings),
700 (bold, rare).`}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"spacing",children:"Spacing"}),`
`,e.jsx(n.p,{children:"A consistent 4px-grid scale:"}),`
`,e.jsx(t,{rows:[{token:"--space-1",usage:"Tight gaps (badge padding, icon margins)"},{token:"--space-2",usage:"Inline spacing, small gaps"},{token:"--space-3",usage:"Form field gaps, compact padding"},{token:"--space-4",usage:"Standard padding, section gaps"},{token:"--space-6",usage:"Panel padding, larger section gaps"},{token:"--space-8",usage:"Page-level spacing"}]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"border-radii",children:"Border radii"}),`
`,e.jsx(t,{rows:[{token:"--radius-xs",usage:"Key pills, tight chips"},{token:"--radius-sm",usage:"Badges, tags, small elements"},{token:"--radius-md",usage:"Inputs, buttons"},{token:"--radius-lg",usage:"Panels, cards"},{token:"--radius-xl",usage:"Modals, large containers"},{token:"--radius-full",usage:"Pills, avatars"}]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"status-colors",children:"Status colors"}),`
`,e.jsx(n.p,{children:`Status colors are the only chromatic exception outside the accent. They appear
minimally — badge dots, tinted backgrounds, subtle text colors — never
full-bleed washes:`}),`
`,e.jsx(d,{rows:[{status:"Success",token:"--color-success",usage:"Done, active, healthy (jade)"},{status:"Error",token:"--color-error",usage:"Failed, validation errors (oxide red)"},{status:"Warning",token:"--color-warning",usage:"Blocked, degraded (muted amber)"},{status:"Info",token:"--color-info",usage:"In progress, informational (graphite — inherits accent)"},{status:"Accent",token:"--color-accent",usage:"Wordmark, primary CTA, links, focus (near-black graphite)"}]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"row-rhythm",children:"Row rhythm"}),`
`,e.jsxs(n.p,{children:["The app uses a single row height, ",e.jsx(n.code,{children:"--input-h"}),`, for every dense interactive
surface: sidebar nav rows, inputs, buttons (`,e.jsx(n.code,{children:"md"}),` size), the scope indicator.
This is also `,e.jsx(n.code,{children:"--sidebar-row-h"}),`. Buttons and inputs placed on the same row line
up without tweaks. The composer is taller (multi-line) but borrows the same
border/radius/colors so it reads as a member of the same family.`]}),`
`,e.jsx(t,{rows:[{token:"--input-h",usage:"Canonical row height for dense interactive surfaces (32px)"},{token:"--sidebar-row-h",usage:"Sidebar nav rows (aliases --input-h)"}]}),`
`,e.jsxs(n.p,{children:["Do not introduce new row heights. If a surface needs to feel denser, use ",e.jsx(n.code,{children:"sm"}),`.
If it needs to feel weightier (hero, auth), use `,e.jsx(n.code,{children:"lg"}),"."]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"motion",children:"Motion"}),`
`,e.jsx(t,{rows:[{token:"--transition-fast",usage:"150ms ease — hover, focus, state changes"},{token:"--transition-normal",usage:"200ms cubic-bezier(0.4,0,0.2,1) — entrances, layout"},{token:"--transition-slow",usage:"500ms cubic-bezier(0.4,0,0.2,1) — page-level reveal"}]}),`
`,e.jsx(n.p,{children:"No bouncy easing. Motion conveys continuity, not delight."}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"elevation",children:"Elevation"}),`
`,e.jsx(n.p,{children:`A single canonical treatment for "lifted" white cards. Composes a 1px
hairline ring (inset via box-shadow — no layout cost) with a whisper of
ambient shadow and a long-range soft shadow. The sheet separates from
the tinted frame without any of the drop-shadow heaviness that reads as
"AI wrapper":`}),`
`,e.jsx(t,{rows:[{token:"--card-elevation",usage:"Raised white cards — content sheet, modals, popovers"}]}),`
`,e.jsxs(n.p,{children:["Apply via ",e.jsx(n.code,{children:"box-shadow: var(--card-elevation)"}),". Pair with ",e.jsx(n.code,{children:"--radius-lg"}),`
and `,e.jsx(n.code,{children:"background: var(--color-card)"}),". Do not combine with ",e.jsx(n.code,{children:"--shadow-md/lg"}),`
— the token already carries its own depth.`]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"using-the-primitives",children:"Using the primitives"}),`
`,e.jsxs(n.p,{children:[e.jsxs(n.strong,{children:["Rule: reach for ",e.jsx(n.code,{children:"components/ui/"})," first."]}),` A new ad-hoc class is the last
resort, not the default. If the thing you want doesn't exist as a primitive,
propose adding it to the library before writing a one-off class in a page-level
stylesheet.`]}),`
`,e.jsx(n.h3,{id:"which-primitive-to-use-when",children:"Which primitive to use when"}),`
`,e.jsxs(n.p,{children:[`| Need                                  | Primitive                   | Don't write                                                |
| ------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| Any `,e.jsx(n.code,{children:"<button>"}),"                        | ",e.jsx(n.code,{children:"<Button variant size>"}),"     | ",e.jsx(n.code,{children:".btn"}),", ",e.jsx(n.code,{children:".auth-btn-*"}),", ",e.jsx(n.code,{children:".modal-btn-*"}),", ",e.jsx(n.code,{children:".newBtn"}),`           |
| Icon-only button                      | `,e.jsx(n.code,{children:"<IconButton variant size>"})," | Bare ",e.jsx(n.code,{children:"<button>"})," with ",e.jsx(n.code,{children:"aria-label"}),` + inline SVG             |
| Any single-line text field            | `,e.jsx(n.code,{children:"<Input size>"}),"              | ",e.jsx(n.code,{children:".auth-input"}),", ",e.jsx(n.code,{children:".filter-input"}),", ",e.jsx(n.code,{children:".agent-settings-input"}),`    |
| Any multi-line text field             | `,e.jsx(n.code,{children:"<Textarea>"}),"                | ",e.jsx(n.code,{children:".modal-textarea"}),", bespoke ",e.jsx(n.code,{children:"<textarea>"}),` rules              |
| Status / tag chip                     | `,e.jsx(n.code,{children:"<Badge>"}),`                   | Hand-rolled status dot + span                              |
| Tag list with removal                 | `,e.jsx(n.code,{children:"<TagList>"}),`                 | Custom chip rows with close-X handlers                     |
| Bordered container (agent, event row) | `,e.jsx(n.code,{children:"<Card variant padding>"}),"    | ",e.jsx(n.code,{children:".agent-card"}),", ",e.jsx(n.code,{children:".event-row"}),", ",e.jsx(n.code,{children:".tool-card"}),", ",e.jsx(n.code,{children:".welcome-card"}),` |
| Detail panel with title bar           | `,e.jsx(n.code,{children:"<Panel title actions>"}),"     | Hand-rolled ",e.jsx(n.code,{children:".detail-panel"})," + ",e.jsx(n.code,{children:"<h2>"}),` header                |
| Detail field (label + value)          | `,e.jsx(n.code,{children:"<DetailField label>"}),"       | Hand-rolled ",e.jsx(n.code,{children:".field-label"})," + ",e.jsx(n.code,{children:"<p>"}),` pair                    |
| Hero metrics row                      | `,e.jsx(n.code,{children:"<HeroStats>"}),`               | Custom flex with inline big-number styles                  |
| Empty list / no-results state         | `,e.jsx(n.code,{children:"<EmptyState>"}),`              | Hand-rolled "No results" div                               |
| Loading + error + empty tri-state     | `,e.jsx(n.code,{children:"<DataState>"}),`               | Three nested ternaries in the page                         |
| Error boundary                        | `,e.jsx(n.code,{children:"<ErrorBoundary>"}),`           | Bespoke class component with state                         |
| Progress indicator (determinate)      | `,e.jsx(n.code,{children:"<ProgressBar>"}),"             | Inline ",e.jsx(n.code,{children:'<div style="width: X%">'}),`                           |
| Loading indicator (indeterminate)     | `,e.jsx(n.code,{children:"<Spinner>"}),`                 | CSS-only spinners in page stylesheets                      |
| Tab bar                               | `,e.jsx(n.code,{children:"<Tabs>"}),`                    | Role=tablist handwritten, focus management bespoke         |
| Hover explainer                       | `,e.jsx(n.code,{children:"<Tooltip>"}),"                 | ",e.jsx(n.code,{children:"title"}),` attribute (inaccessible, ugly on mobile)           |
| Modal dialog                          | `,e.jsx(n.code,{children:"<Modal>"}),"                   | ",e.jsx(n.code,{children:"position: fixed"})," divs                                     |"]}),`
`,e.jsx(n.h3,{id:"token-rules",children:"Token rules"}),`
`,e.jsxs(n.ul,{children:[`
`,e.jsxs(n.li,{children:[e.jsx(n.code,{children:"--input-*"})," tokens are the source of truth for ",e.jsx(n.strong,{children:"every field-like surface"}),`.
`,e.jsx(n.code,{children:"<Input>"}),", ",e.jsx(n.code,{children:"<Textarea>"}),`, the composer, and the few remaining class-based
inputs (`,e.jsx(n.code,{children:".filter-input"}),", ",e.jsx(n.code,{children:".agent-settings-input"}),", ",e.jsx(n.code,{children:".events-link-input"}),`) all
consume them. Edit once, update everywhere.`]}),`
`,e.jsxs(n.li,{children:["Never hardcode ",e.jsx(n.code,{children:"#ffffff"}),", ",e.jsx(n.code,{children:"rgba(0, 0, 0, 0.x)"}),`, or hex colors in component
CSS. Use a token. If the token you need doesn't exist, add it to
`,e.jsx(n.code,{children:"@aeqi/tokens"})," (shared) first, then alias it in ",e.jsx(n.code,{children:"primitives.css"}),"."]}),`
`,e.jsxs(n.li,{children:["Never hardcode radius values. Use ",e.jsx(n.code,{children:"--radius-md"}),` for inputs/buttons,
`,e.jsx(n.code,{children:"--radius-lg"})," for cards/panels, ",e.jsx(n.code,{children:"--radius-xl"})," for modals."]}),`
`,e.jsxs(n.li,{children:["Never hardcode transition timings. Use ",e.jsx(n.code,{children:"--transition-fast"}),` for interaction,
`,e.jsx(n.code,{children:"--transition-normal"})," for layout."]}),`
`]}),`
`,e.jsx(n.h3,{id:"adding-a-new-primitive",children:"Adding a new primitive"}),`
`,e.jsxs(n.ol,{children:[`
`,e.jsxs(n.li,{children:["Start from an existing one (",e.jsx(n.code,{children:"Input.tsx"})," / ",e.jsx(n.code,{children:"Input.module.css"})," are the cleanest template)."]}),`
`,e.jsxs(n.li,{children:["Props: ",e.jsx(n.code,{children:"variant"}),", ",e.jsx(n.code,{children:"size"}),", ",e.jsx(n.code,{children:"className"}),", then role-specific props. Always accept ",e.jsx(n.code,{children:"className"})," and forward it last so call sites can extend."]}),`
`,e.jsxs(n.li,{children:["CSS module: use ",e.jsx(n.code,{children:"--input-*"}),", ",e.jsx(n.code,{children:"--space-*"}),", ",e.jsx(n.code,{children:"--radius-*"}),", ",e.jsx(n.code,{children:"--text-*"})," tokens only."]}),`
`,e.jsx(n.li,{children:"Add a Storybook story showing every variant and every size."}),`
`,e.jsxs(n.li,{children:["Export from ",e.jsx(n.code,{children:"index.ts"}),"."]}),`
`,e.jsx(n.li,{children:"Document it in the table above."}),`
`]}),`
`,e.jsx(n.hr,{}),`
`,e.jsx(n.h2,{id:"sources-of-truth",children:"Sources of truth"}),`
`,e.jsxs(n.p,{children:[`| Artifact                            | Role                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `,e.jsx(n.code,{children:"packages/tokens/src/tokens.css"}),"    | ",e.jsx(n.strong,{children:"Values"}),`: colors, fonts, spacing, radii, shadows, motion. The one source. |
| `,e.jsx(n.code,{children:"packages/tokens/src/tokens.ts"}),`     | TypeScript mirror of tokens.css — for canvas/chart/JS consumers.            |
| `,e.jsx(n.code,{children:"apps/ui/src/styles/primitives.css"}),` | Dashboard aliases + dashboard-only tokens (input-h, sidebar, etc).          |
| `,e.jsx(n.code,{children:"apps/ui/src/components/ui/"}),`        | The 18 primitives + Storybook stories — the component API.                  |
| This doc                            | `,e.jsx(n.strong,{children:"Rules"}),`: how to use, when to use which primitive, what not to do.         |
| `,e.jsx(n.code,{children:"/brand"}),` on aeqi.ai                 | Public brand reference — palette, typography, downloads.                    |
| `,e.jsx(n.code,{children:"apps/ui/.impeccable.md"}),"            | AI context file — design philosophy + pointer to this doc.                  |"]})]})}function w(s={}){const{wrapper:n}={...a(),...s.components};return n?e.jsx(n,{...s,children:e.jsx(o,{...s})}):o(s)}export{w as default};
