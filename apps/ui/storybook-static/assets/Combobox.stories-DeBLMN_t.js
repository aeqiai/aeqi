import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r}from"./index-oxIuDU2I.js";import{P as me}from"./Popover-Bw-spCWH.js";import"./_commonjsHelpers-CqkleIqs.js";const he="_wrapper_d4tst_9",ge="_trigger_d4tst_15",fe="_triggerLabel_d4tst_51",be="_triggerPlaceholder_d4tst_58",ve="_chevron_d4tst_62",xe="_chevronOpen_d4tst_71",Se="_sm_d4tst_77",ye="_panel_d4tst_85",_e="_search_d4tst_99",Ce="_searchIcon_d4tst_107",je="_searchInput_d4tst_115",ke="_list_d4tst_133",Oe="_option_d4tst_139",Te="_optionActive_d4tst_160",Ne="_optionSelected_d4tst_164",Le="_optionLabel_d4tst_169",Ie="_optionMeta_d4tst_176",Pe="_checkmark_d4tst_185",ze="_empty_d4tst_196",we="_footer_d4tst_205",a={wrapper:he,trigger:ge,triggerLabel:fe,triggerPlaceholder:be,chevron:ve,chevronOpen:xe,sm:Se,panel:ye,search:_e,searchIcon:Ce,searchInput:je,list:ke,option:Oe,optionActive:Te,optionSelected:Ne,optionLabel:Le,optionMeta:Ie,checkmark:Pe,empty:ze,footer:we};function i({options:o,value:s,onChange:N,placeholder:ae="Select…",searchPlaceholder:re="Search…",emptyLabel:le="No matches",size:ie="md",disabled:C,className:ce,footer:L}){const[u,I]=r.useState(!1),[j,k]=r.useState(""),[p,m]=r.useState(0),P=r.useId(),z=r.useRef(null),w=r.useRef(null),O=r.useRef(new Map),T=o.find(t=>t.value===s)??null,l=j.trim()?o.filter(t=>t.label.toLowerCase().includes(j.trim().toLowerCase())):o;r.useEffect(()=>{m(t=>Math.min(t,Math.max(0,l.length-1)))},[l.length]),r.useEffect(()=>{var n;if(!u)return;const t=l[p];t&&((n=O.current.get(t.value))==null||n.scrollIntoView({block:"nearest"}))},[p,l,u]);const de=r.useCallback(()=>{if(C)return;const t=s?l.findIndex(n=>n.value===s):-1;m(t>=0?t:0),k(""),I(!0),requestAnimationFrame(()=>{var n;return(n=w.current)==null?void 0:n.focus()})},[C,l,s]),h=r.useCallback(()=>{I(!1),k(""),requestAnimationFrame(()=>{var t;return(t=z.current)==null?void 0:t.focus()})},[]),V=r.useCallback(t=>{h(),t!==s&&N(t)},[h,N,s]),W=t=>{if(t.key==="ArrowDown"){t.preventDefault();const n=l.findIndex((c,d)=>d>p&&!c.disabled);n>=0&&m(n)}else if(t.key==="ArrowUp"){t.preventDefault();const n=l.map((c,d)=>d).filter(c=>c<p&&!l[c].disabled);n.length>0&&m(n[n.length-1])}else if(t.key==="Enter"){t.preventDefault();const n=l[p];n&&!n.disabled&&V(n.value)}else t.key==="Escape"&&(t.preventDefault(),h())},ue=[a.wrapper,a[ie],ce].filter(Boolean).join(" ");return e.jsx("div",{className:ue,children:e.jsx(me,{open:u,onOpenChange:t=>{t||h()},placement:"bottom-start",trigger:e.jsxs("button",{ref:z,type:"button",className:a.trigger,disabled:C,"aria-haspopup":"listbox","aria-expanded":u,"aria-controls":P,onClick:()=>u?h():de(),children:[e.jsx("span",{className:[a.triggerLabel,T?"":a.triggerPlaceholder].filter(Boolean).join(" "),children:T?T.label:ae}),e.jsx("span",{className:[a.chevron,u?a.chevronOpen:""].filter(Boolean).join(" "),"aria-hidden":"true",children:e.jsx("svg",{width:"10",height:"6",viewBox:"0 0 10 6",fill:"none",children:e.jsx("path",{d:"M1 1L5 5L9 1",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round"})})})]}),children:e.jsxs("div",{className:a.panel,role:"listbox",id:P,"aria-label":"Options",onKeyDown:W,children:[e.jsxs("div",{className:a.search,children:[e.jsx("span",{className:a.searchIcon,"aria-hidden":"true",children:e.jsxs("svg",{width:"12",height:"12",viewBox:"0 0 12 12",fill:"none",children:[e.jsx("circle",{cx:"5",cy:"5",r:"3.5",stroke:"currentColor",strokeWidth:"1.2"}),e.jsx("path",{d:"M7.6 7.6 L10 10",stroke:"currentColor",strokeWidth:"1.2",strokeLinecap:"round"})]})}),e.jsx("input",{ref:w,className:a.searchInput,type:"text",value:j,placeholder:re,spellCheck:!1,autoComplete:"off",onChange:t=>{k(t.target.value),m(0)},onKeyDown:W})]}),e.jsxs("div",{className:a.list,role:"presentation",children:[l.length===0&&e.jsx("div",{className:a.empty,children:le}),l.map((t,n)=>{const c=n===p,d=t.value===s,pe=[a.option,c?a.optionActive:"",d?a.optionSelected:""].filter(Boolean).join(" ");return e.jsxs("button",{ref:A=>{A?O.current.set(t.value,A):O.current.delete(t.value)},type:"button",role:"option","aria-selected":d,className:pe,disabled:t.disabled,onMouseEnter:()=>!t.disabled&&m(n),onClick:()=>!t.disabled&&V(t.value),children:[e.jsx("span",{className:a.checkmark,"aria-hidden":"true",children:d&&e.jsx("svg",{width:"12",height:"12",viewBox:"0 0 12 12",fill:"none",children:e.jsx("path",{d:"M2 6L5 9L10 3",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round"})})}),e.jsx("span",{className:a.optionLabel,children:t.label}),t.meta!=null&&e.jsx("span",{className:a.optionMeta,children:t.meta})]},t.value)})]}),L!=null&&e.jsx("div",{className:a.footer,children:L})]})})})}i.displayName="Combobox";i.__docgenInfo={description:"",methods:[],displayName:"Combobox",props:{options:{required:!0,tsType:{name:"Array",elements:[{name:"ComboboxOption"}],raw:"ComboboxOption[]"},description:""},value:{required:!0,tsType:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]},description:""},onChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(value: string) => void",signature:{arguments:[{type:{name:"string"},name:"value"}],return:{name:"void"}}},description:""},placeholder:{required:!1,tsType:{name:"ReactNode"},description:"Trigger text (or node) when nothing is selected.",defaultValue:{value:'"Select…"',computed:!1}},searchPlaceholder:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'"Search…"',computed:!1}},emptyLabel:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'"No matches"',computed:!1}},size:{required:!1,tsType:{name:"union",raw:'"sm" | "md"',elements:[{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'}]},description:"",defaultValue:{value:'"md"',computed:!1}},disabled:{required:!1,tsType:{name:"boolean"},description:""},className:{required:!1,tsType:{name:"string"},description:""},footer:{required:!1,tsType:{name:"ReactNode"},description:"Optional content rendered at the bottom of the floating panel (e.g. custom entry forms)."}}};const _=[{value:"self",label:"Self"},{value:"siblings",label:"Siblings"},{value:"children",label:"Children"},{value:"branch",label:"Branch"},{value:"global",label:"Global"}],oe=[{value:"anthropic/claude-opus-4",label:"Claude Opus 4",meta:e.jsx("span",{style:{fontSize:"0.7rem",opacity:.6},children:"frontier · 200K"})},{value:"anthropic/claude-sonnet-4-6",label:"Claude Sonnet 4.6",meta:e.jsx("span",{style:{fontSize:"0.7rem",opacity:.6},children:"balanced · 200K"})},{value:"anthropic/claude-haiku-4",label:"Claude Haiku 4",meta:e.jsx("span",{style:{fontSize:"0.7rem",opacity:.6},children:"cheap · 200K"})},{value:"openai/gpt-4o",label:"GPT-4o",meta:e.jsx("span",{style:{fontSize:"0.7rem",opacity:.6},children:"balanced"}),disabled:!0},{value:"google/gemini-2-flash",label:"Gemini 2.0 Flash",meta:e.jsx("span",{style:{fontSize:"0.7rem",opacity:.6},children:"cheap"})}],Ve=Array.from({length:60},(o,s)=>({value:`option-${s+1}`,label:`Option ${s+1} — item ${String.fromCharCode(65+s%26)}${s+1}`,meta:s%7===0?e.jsx("span",{style:{fontSize:"0.7rem",color:"var(--accent)"},children:"★"}):void 0})),Ee={title:"Primitives/Inputs/Combobox",component:i,tags:["autodocs"],parameters:{layout:"padded"}},g={name:"Basic usage",render:()=>{const[o,s]=r.useState("self");return e.jsxs("div",{style:{maxWidth:240},children:[e.jsx(i,{options:_,value:o,onChange:s,placeholder:"Select scope…"}),e.jsxs("p",{style:{marginTop:8,fontSize:12,color:"rgba(0,0,0,0.45)"},children:["Selected: ",e.jsx("strong",{children:o??"—"})]})]})}},f={name:"50+ options",render:()=>{const[o,s]=r.useState("option-1");return e.jsxs("div",{style:{maxWidth:300},children:[e.jsx(i,{options:Ve,value:o,onChange:s,placeholder:"Pick an option…",searchPlaceholder:"Filter options…"}),e.jsxs("p",{style:{marginTop:8,fontSize:12,color:"rgba(0,0,0,0.45)"},children:["Selected: ",e.jsx("strong",{children:o??"—"})]})]})}},b={name:"With meta (label + secondary text)",render:()=>{const[o,s]=r.useState("anthropic/claude-sonnet-4-6");return e.jsxs("div",{style:{maxWidth:300},children:[e.jsx(i,{options:oe,value:o,onChange:s,placeholder:"Choose a model…",searchPlaceholder:"Search models…"}),e.jsxs("p",{style:{marginTop:8,fontSize:12,color:"rgba(0,0,0,0.45)"},children:["Selected: ",e.jsx("strong",{children:o??"—"})]})]})}},v={name:"Disabled options",render:()=>{const[o,s]=r.useState("anthropic/claude-opus-4");return e.jsxs("div",{style:{maxWidth:300},children:[e.jsx(i,{options:oe,value:o,onChange:s,placeholder:"Choose a model…"}),e.jsxs("p",{style:{marginTop:8,fontSize:12,color:"rgba(0,0,0,0.45)"},children:["GPT-4o is disabled. Selected: ",e.jsx("strong",{children:o??"—"})]})]})}},x={name:"Empty state",render:()=>{const[o,s]=r.useState(null);return e.jsx("div",{style:{maxWidth:240},children:e.jsx(i,{options:_,value:o,onChange:s,placeholder:"Select scope…",searchPlaceholder:"Try typing 'zzz' to see empty state…",emptyLabel:"No scopes match your search"})})}},S={name:"Disabled trigger",args:{options:_,value:"self",disabled:!0}},y={name:"Size: sm",render:()=>{const[o,s]=r.useState("self");return e.jsx("div",{style:{maxWidth:200},children:e.jsx(i,{options:_,value:o,onChange:s,size:"sm"})})}};var B,D,E;g.parameters={...g.parameters,docs:{...(B=g.parameters)==null?void 0:B.docs,source:{originalSource:`{
  name: "Basic usage",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("self");
    return <div style={{
      maxWidth: 240
    }}>
        <Combobox options={BASIC_OPTIONS} value={value} onChange={setValue} placeholder="Select scope…" />
        <p style={{
        marginTop: 8,
        fontSize: 12,
        color: "rgba(0,0,0,0.45)"
      }}>
          Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>;
  }
}`,...(E=(D=g.parameters)==null?void 0:D.docs)==null?void 0:E.source}}};var M,q,R;f.parameters={...f.parameters,docs:{...(M=f.parameters)==null?void 0:M.docs,source:{originalSource:`{
  name: "50+ options",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("option-1");
    return <div style={{
      maxWidth: 300
    }}>
        <Combobox options={LARGE_OPTIONS} value={value} onChange={setValue} placeholder="Pick an option…" searchPlaceholder="Filter options…" />
        <p style={{
        marginTop: 8,
        fontSize: 12,
        color: "rgba(0,0,0,0.45)"
      }}>
          Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>;
  }
}`,...(R=(q=f.parameters)==null?void 0:q.docs)==null?void 0:R.source}}};var G,F,K;b.parameters={...b.parameters,docs:{...(G=b.parameters)==null?void 0:G.docs,source:{originalSource:`{
  name: "With meta (label + secondary text)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("anthropic/claude-sonnet-4-6");
    return <div style={{
      maxWidth: 300
    }}>
        <Combobox options={MODEL_OPTIONS} value={value} onChange={setValue} placeholder="Choose a model…" searchPlaceholder="Search models…" />
        <p style={{
        marginTop: 8,
        fontSize: 12,
        color: "rgba(0,0,0,0.45)"
      }}>
          Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>;
  }
}`,...(K=(F=b.parameters)==null?void 0:F.docs)==null?void 0:K.source}}};var $,H,Q;v.parameters={...v.parameters,docs:{...($=v.parameters)==null?void 0:$.docs,source:{originalSource:`{
  name: "Disabled options",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("anthropic/claude-opus-4");
    return <div style={{
      maxWidth: 300
    }}>
        <Combobox options={MODEL_OPTIONS} value={value} onChange={setValue} placeholder="Choose a model…" />
        <p style={{
        marginTop: 8,
        fontSize: 12,
        color: "rgba(0,0,0,0.45)"
      }}>
          GPT-4o is disabled. Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>;
  }
}`,...(Q=(H=v.parameters)==null?void 0:H.docs)==null?void 0:Q.source}}};var U,J,X;x.parameters={...x.parameters,docs:{...(U=x.parameters)==null?void 0:U.docs,source:{originalSource:`{
  name: "Empty state",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>(null);
    return <div style={{
      maxWidth: 240
    }}>
        <Combobox options={BASIC_OPTIONS} value={value} onChange={setValue} placeholder="Select scope…" searchPlaceholder="Try typing 'zzz' to see empty state…" emptyLabel="No scopes match your search" />
      </div>;
  }
}`,...(X=(J=x.parameters)==null?void 0:J.docs)==null?void 0:X.source}}};var Y,Z,ee;S.parameters={...S.parameters,docs:{...(Y=S.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  name: "Disabled trigger",
  args: {
    options: BASIC_OPTIONS,
    value: "self",
    disabled: true
  }
}`,...(ee=(Z=S.parameters)==null?void 0:Z.docs)==null?void 0:ee.source}}};var te,se,ne;y.parameters={...y.parameters,docs:{...(te=y.parameters)==null?void 0:te.docs,source:{originalSource:`{
  name: "Size: sm",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("self");
    return <div style={{
      maxWidth: 200
    }}>
        <Combobox options={BASIC_OPTIONS} value={value} onChange={setValue} size="sm" />
      </div>;
  }
}`,...(ne=(se=y.parameters)==null?void 0:se.docs)==null?void 0:ne.source}}};const Me=["Basic","LargeList","WithMeta","DisabledOptions","EmptyState","DisabledTrigger","SizeSm"];export{g as Basic,v as DisabledOptions,S as DisabledTrigger,x as EmptyState,f as LargeList,y as SizeSm,b as WithMeta,Me as __namedExportsOrder,Ee as default};
