import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as h}from"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const $="_wrapper_9memv_7",ee="_fullWidth_9memv_13",se="_select_9memv_18",ae="_sm_9memv_54",ne="_chevron_9memv_61",re="_md_9memv_65",r={wrapper:$,fullWidth:ee,select:se,sm:ae,chevron:ne,md:re},n=h.forwardRef(function({options:v,value:G,onChange:S,placeholder:f,disabled:H,size:F="md",fullWidth:J,className:K,id:Q,...U},X){const Y=h.useId(),Z=Q||Y;return e.jsxs("div",{className:[r.wrapper,r[F],J&&r.fullWidth,K].filter(Boolean).join(" "),children:[e.jsxs("select",{ref:X,id:Z,className:r.select,value:G,disabled:H,onChange:a=>S==null?void 0:S(a.target.value),...U,children:[f&&e.jsx("option",{value:"",disabled:!0,children:f}),v.map(a=>e.jsx("option",{value:a.value,disabled:a.disabled,children:a.label},a.value))]}),e.jsx("span",{className:r.chevron,"aria-hidden":"true",children:e.jsx("svg",{width:"10",height:"6",viewBox:"0 0 10 6",fill:"none",children:e.jsx("path",{d:"M1 1L5 5L9 1",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round"})})})]})});n.displayName="Select";n.__docgenInfo={description:"",methods:[],displayName:"Select",props:{options:{required:!0,tsType:{name:"Array",elements:[{name:"SelectOption"}],raw:"SelectOption[]"},description:""},value:{required:!1,tsType:{name:"string"},description:""},onChange:{required:!1,tsType:{name:"signature",type:"function",raw:"(value: string) => void",signature:{arguments:[{type:{name:"string"},name:"value"}],return:{name:"void"}}},description:""},placeholder:{required:!1,tsType:{name:"string"},description:""},disabled:{required:!1,tsType:{name:"boolean"},description:""},size:{required:!1,tsType:{name:"union",raw:'"sm" | "md"',elements:[{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'}]},description:"",defaultValue:{value:'"md"',computed:!1}},fullWidth:{required:!1,tsType:{name:"boolean"},description:"Stretch the wrapper to fill its container."},className:{required:!1,tsType:{name:"string"},description:""}},composes:["Omit"]};const s=[{value:"self",label:"self"},{value:"siblings",label:"siblings"},{value:"children",label:"children"},{value:"branch",label:"branch"},{value:"global",label:"global"}],A=[{value:"claude-opus-4",label:"Claude Opus 4"},{value:"claude-sonnet-4-5",label:"Claude Sonnet 4.5"},{value:"claude-haiku-4",label:"Claude Haiku 4"},{value:"gpt-4o",label:"GPT-4o",disabled:!0}],ie={title:"Primitives/Inputs/Select",component:n,tags:["autodocs"]},t={args:{options:s,value:"self"}},l={name:"Size: sm",args:{options:s,value:"self",size:"sm"}},o={name:"Size: md",args:{options:s,value:"self",size:"md"}},i={name:"Empty state (placeholder)",args:{options:A,placeholder:"Select a model…",value:""}},d={args:{options:s,value:"global",disabled:!0}},c={name:"Option disabled",args:{options:A,value:"claude-opus-4"}},m={name:"Controlled (interactive)",render:()=>{const[p,v]=h.useState("self");return e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8,maxWidth:240},children:[e.jsx(n,{options:s,value:p,onChange:v}),e.jsxs("p",{style:{fontSize:12,color:"rgba(0,0,0,0.45)",margin:0},children:["Selected: ",e.jsx("strong",{children:p})]})]})}},u={name:"Both sizes",render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:12,maxWidth:240},children:[e.jsx(n,{options:s,value:"self",size:"sm"}),e.jsx(n,{options:s,value:"self",size:"md"})]})};var g,O,b;t.parameters={...t.parameters,docs:{...(g=t.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    options: SCOPE_OPTIONS,
    value: "self"
  }
}`,...(b=(O=t.parameters)==null?void 0:O.docs)==null?void 0:b.source}}};var x,_,y;l.parameters={...l.parameters,docs:{...(x=l.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: "Size: sm",
  args: {
    options: SCOPE_OPTIONS,
    value: "self",
    size: "sm"
  }
}`,...(y=(_=l.parameters)==null?void 0:_.docs)==null?void 0:y.source}}};var z,P,T;o.parameters={...o.parameters,docs:{...(z=o.parameters)==null?void 0:z.docs,source:{originalSource:`{
  name: "Size: md",
  args: {
    options: SCOPE_OPTIONS,
    value: "self",
    size: "md"
  }
}`,...(T=(P=o.parameters)==null?void 0:P.docs)==null?void 0:T.source}}};var j,N,C;i.parameters={...i.parameters,docs:{...(j=i.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: "Empty state (placeholder)",
  args: {
    options: MODEL_OPTIONS,
    placeholder: "Select a model…",
    value: ""
  }
}`,...(C=(N=i.parameters)==null?void 0:N.docs)==null?void 0:C.source}}};var E,I,W;d.parameters={...d.parameters,docs:{...(E=d.parameters)==null?void 0:E.docs,source:{originalSource:`{
  args: {
    options: SCOPE_OPTIONS,
    value: "global",
    disabled: true
  }
}`,...(W=(I=d.parameters)==null?void 0:I.docs)==null?void 0:W.source}}};var D,w,k;c.parameters={...c.parameters,docs:{...(D=c.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: "Option disabled",
  args: {
    options: MODEL_OPTIONS,
    value: "claude-opus-4"
  }
}`,...(k=(w=c.parameters)==null?void 0:w.docs)==null?void 0:k.source}}};var q,L,B;m.parameters={...m.parameters,docs:{...(q=m.parameters)==null?void 0:q.docs,source:{originalSource:`{
  name: "Controlled (interactive)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState("self");
    return <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 8,
      maxWidth: 240
    }}>
        <Select options={SCOPE_OPTIONS} value={value} onChange={setValue} />
        <p style={{
        fontSize: 12,
        color: "rgba(0,0,0,0.45)",
        margin: 0
      }}>
          Selected: <strong>{value}</strong>
        </p>
      </div>;
  }
}`,...(B=(L=m.parameters)==null?void 0:L.docs)==null?void 0:B.source}}};var M,V,R;u.parameters={...u.parameters,docs:{...(M=u.parameters)==null?void 0:M.docs,source:{originalSource:`{
  name: "Both sizes",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxWidth: 240
  }}>
      <Select options={SCOPE_OPTIONS} value="self" size="sm" />
      <Select options={SCOPE_OPTIONS} value="self" size="md" />
    </div>
}`,...(R=(V=u.parameters)==null?void 0:V.docs)==null?void 0:R.source}}};const de=["Default","SizeSm","SizeMd","WithPlaceholder","Disabled","WithDisabledOption","Controlled","BothSizes"];export{u as BothSizes,m as Controlled,t as Default,d as Disabled,o as SizeMd,l as SizeSm,c as WithDisabledOption,i as WithPlaceholder,de as __namedExportsOrder,ie as default};
