import{j as e}from"./jsx-runtime-D_zvdyIk.js";const b="_dot_1g3we_1",z="_pulse_1g3we_1",k="_sm_1g3we_9",w="_md_1g3we_15",t={dot:b,pulse:z,sm:k,md:w};function n({size:S="sm",className:_}){return e.jsx("span",{className:[t.dot,t[S],_].filter(Boolean).join(" "),role:"status","aria-label":"Thinking"})}n.displayName="ThinkingDot";n.__docgenInfo={description:"",methods:[],displayName:"ThinkingDot",props:{size:{required:!1,tsType:{name:"union",raw:'"sm" | "md"',elements:[{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'}]},description:"",defaultValue:{value:'"sm"',computed:!1}},className:{required:!1,tsType:{name:"string"},description:""}}};const j={title:"Primitives/Feedback/ThinkingDot",component:n,tags:["autodocs"],parameters:{layout:"centered"}},s={args:{size:"sm"}},a={args:{size:"md"}},i={name:"Inline with Label (Thinking Panel)",render:()=>e.jsxs("div",{style:{display:"inline-flex",alignItems:"center",gap:8},children:[e.jsx(n,{size:"sm"}),e.jsx("span",{style:{fontFamily:"monospace",fontSize:11,color:"rgba(0,0,0,0.55)"},children:"thinking..."})]})},r={name:"Row Status (Sessions Rail)",render:()=>e.jsxs("div",{style:{display:"inline-flex",alignItems:"center",gap:10,padding:"6px 10px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:6},children:[e.jsx(n,{size:"md"}),e.jsx("span",{style:{fontSize:13},children:"drafting deploy notes…"})]})};var o,l,d;s.parameters={...s.parameters,docs:{...(o=s.parameters)==null?void 0:o.docs,source:{originalSource:`{
  args: {
    size: "sm"
  }
}`,...(d=(l=s.parameters)==null?void 0:l.docs)==null?void 0:d.source}}};var m,p,c;a.parameters={...a.parameters,docs:{...(m=a.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {
    size: "md"
  }
}`,...(c=(p=a.parameters)==null?void 0:p.docs)==null?void 0:c.source}}};var g,u,y;i.parameters={...i.parameters,docs:{...(g=i.parameters)==null?void 0:g.docs,source:{originalSource:`{
  name: "Inline with Label (Thinking Panel)",
  render: () => <div style={{
    display: "inline-flex",
    alignItems: "center",
    gap: 8
  }}>
      <ThinkingDot size="sm" />
      <span style={{
      fontFamily: "monospace",
      fontSize: 11,
      color: "rgba(0,0,0,0.55)"
    }}>
        thinking...
      </span>
    </div>
}`,...(y=(u=i.parameters)==null?void 0:u.docs)==null?void 0:y.source}}};var f,x,h;r.parameters={...r.parameters,docs:{...(f=r.parameters)==null?void 0:f.docs,source:{originalSource:`{
  name: "Row Status (Sessions Rail)",
  render: () => <div style={{
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 10px",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 6
  }}>
      <ThinkingDot size="md" />
      <span style={{
      fontSize: 13
    }}>drafting deploy notes…</span>
    </div>
}`,...(h=(x=r.parameters)==null?void 0:x.docs)==null?void 0:h.source}}};const v=["Small","Medium","InlineWithLabel","AsRowStatus"];export{r as AsRowStatus,i as InlineWithLabel,a as Medium,s as Small,v as __namedExportsOrder,j as default};
