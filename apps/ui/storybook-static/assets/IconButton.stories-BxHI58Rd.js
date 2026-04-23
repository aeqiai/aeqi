import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as K}from"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const Q="_button_udpx9_5",U="_ghost_udpx9_38",X="_bordered_udpx9_48",Y="_danger_udpx9_58",Z="_xs_udpx9_65",$="_sm_udpx9_71",ee="_md_udpx9_77",u={button:Q,ghost:U,bordered:X,danger:Y,xs:Z,sm:$,md:ee},n=K.forwardRef(function({variant:H="ghost",size:L="sm",className:O,children:V,type:N="button",...G},P){const J=[u.button,u[H],u[L],O].filter(Boolean).join(" ");return e.jsx("button",{ref:P,type:N,className:J,...G,children:V})});n.displayName="IconButton";n.__docgenInfo={description:"",methods:[],displayName:"IconButton",props:{variant:{required:!1,tsType:{name:"union",raw:'"ghost" | "bordered" | "danger"',elements:[{name:"literal",value:'"ghost"'},{name:"literal",value:'"bordered"'},{name:"literal",value:'"danger"'}]},description:"",defaultValue:{value:'"ghost"',computed:!1}},size:{required:!1,tsType:{name:"union",raw:'"xs" | "sm" | "md"',elements:[{name:"literal",value:'"xs"'},{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'}]},description:"",defaultValue:{value:'"sm"',computed:!1}},"aria-label":{required:!0,tsType:{name:"string"},description:"Accessible label — required; icon-only buttons must expose a name."},type:{defaultValue:{value:'"button"',computed:!1},required:!1}}};function r(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M4 4l8 8M12 4l-8 8",strokeLinecap:"round"})})}function W(){return e.jsxs("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:[e.jsx("rect",{x:"5",y:"5",width:"9",height:"9",rx:"1.5"}),e.jsx("path",{d:"M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"})]})}function m(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4l.8 9a1 1 0 0 0 1 .9h2.4a1 1 0 0 0 1-.9L11 4"})})}function ne(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M11 2l3 3-8 8H3v-3z",strokeLinejoin:"round"})})}function re(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M6 4l4 4-4 4",strokeLinecap:"round",strokeLinejoin:"round"})})}const te={title:"Components/IconButton",component:n,tags:["autodocs"],parameters:{docs:{description:{component:"Icon-only button primitive for dense toolbars, detail panels, and row actions. Requires `aria-label` — an icon without a name is a button nobody can read with assistive tech."}}},argTypes:{variant:{control:"select",options:["ghost","bordered","danger"]},size:{control:"select",options:["xs","sm","md"]}},args:{"aria-label":"Example action",children:e.jsx(r,{})}},o={args:{variant:"ghost","aria-label":"Close panel",children:e.jsx(r,{})}},s={args:{variant:"bordered","aria-label":"Copy value",children:e.jsx(W,{})}},t={args:{variant:"danger","aria-label":"Delete",children:e.jsx(m,{})}},i={name:"Size Scale",render:a=>e.jsxs("div",{style:{display:"flex",gap:8,alignItems:"center"},children:[e.jsx(n,{...a,size:"xs","aria-label":"Close (xs)",children:e.jsx(r,{})}),e.jsx(n,{...a,size:"sm","aria-label":"Close (sm)",children:e.jsx(r,{})}),e.jsx(n,{...a,size:"md","aria-label":"Close (md)",children:e.jsx(r,{})})]})},l={args:{disabled:!0,"aria-label":"Delete",children:e.jsx(m,{})}},d={name:"Detail Panel Header",render:()=>e.jsxs("div",{style:{width:320,padding:"12px 14px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"},children:[e.jsx("code",{style:{fontFamily:"var(--font-mono)",fontSize:13,fontWeight:600},children:"onboarding-skill"}),e.jsx(n,{"aria-label":"Close detail",children:e.jsx(r,{})})]})},c={name:"Row Action Cluster",render:()=>e.jsxs("div",{style:{width:360,padding:"10px 12px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,display:"flex",alignItems:"center",gap:12},children:[e.jsx("span",{style:{flex:1,fontSize:13},children:"quest-42 · Ship the rebrand"}),e.jsx(n,{size:"xs","aria-label":"Edit quest",children:e.jsx(ne,{})}),e.jsx(n,{size:"xs",variant:"danger","aria-label":"Delete quest",children:e.jsx(m,{})}),e.jsx(n,{size:"xs","aria-label":"Open quest",children:e.jsx(re,{})})]})},p={name:"Copy Field",render:()=>e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,padding:4,border:"1px solid rgba(0,0,0,0.08)",borderRadius:6,width:320},children:[e.jsx("code",{style:{flex:1,fontFamily:"var(--font-mono)",fontSize:12,padding:"0 8px",color:"rgba(0,0,0,0.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:"sk-aeqi-7f3c9d2b8a0e1f4c5d6e7f8a9b0c1d2e"}),e.jsx(n,{variant:"bordered","aria-label":"Copy secret",children:e.jsx(W,{})})]})};var x,b,g;o.parameters={...o.parameters,docs:{...(x=o.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    variant: "ghost",
    "aria-label": "Close panel",
    children: <CloseIcon />
  }
}`,...(g=(b=o.parameters)==null?void 0:b.docs)==null?void 0:g.source}}};var h,f,v;s.parameters={...s.parameters,docs:{...(h=s.parameters)==null?void 0:h.docs,source:{originalSource:`{
  args: {
    variant: "bordered",
    "aria-label": "Copy value",
    children: <CopyIcon />
  }
}`,...(v=(f=s.parameters)==null?void 0:f.docs)==null?void 0:v.source}}};var y,I,j;t.parameters={...t.parameters,docs:{...(y=t.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    variant: "danger",
    "aria-label": "Delete",
    children: <TrashIcon />
  }
}`,...(j=(I=t.parameters)==null?void 0:I.docs)==null?void 0:j.source}}};var C,w,B;i.parameters={...i.parameters,docs:{...(C=i.parameters)==null?void 0:C.docs,source:{originalSource:`{
  name: "Size Scale",
  render: args => <div style={{
    display: "flex",
    gap: 8,
    alignItems: "center"
  }}>
      <IconButton {...args} size="xs" aria-label="Close (xs)">
        <CloseIcon />
      </IconButton>
      <IconButton {...args} size="sm" aria-label="Close (sm)">
        <CloseIcon />
      </IconButton>
      <IconButton {...args} size="md" aria-label="Close (md)">
        <CloseIcon />
      </IconButton>
    </div>
}`,...(B=(w=i.parameters)==null?void 0:w.docs)==null?void 0:B.source}}};var z,_,S;l.parameters={...l.parameters,docs:{...(z=l.parameters)==null?void 0:z.docs,source:{originalSource:`{
  args: {
    disabled: true,
    "aria-label": "Delete",
    children: <TrashIcon />
  }
}`,...(S=(_=l.parameters)==null?void 0:_.docs)==null?void 0:S.source}}};var k,q,D;d.parameters={...d.parameters,docs:{...(k=d.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: "Detail Panel Header",
  render: () => <div style={{
    width: 320,
    padding: "12px 14px",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between"
  }}>
      <code style={{
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      fontWeight: 600
    }}>
        onboarding-skill
      </code>
      <IconButton aria-label="Close detail">
        <CloseIcon />
      </IconButton>
    </div>
}`,...(D=(q=d.parameters)==null?void 0:q.docs)==null?void 0:D.source}}};var R,A,E;c.parameters={...c.parameters,docs:{...(R=c.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: "Row Action Cluster",
  render: () => <div style={{
    width: 360,
    padding: "10px 12px",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    gap: 12
  }}>
      <span style={{
      flex: 1,
      fontSize: 13
    }}>quest-42 · Ship the rebrand</span>
      <IconButton size="xs" aria-label="Edit quest">
        <EditIcon />
      </IconButton>
      <IconButton size="xs" variant="danger" aria-label="Delete quest">
        <TrashIcon />
      </IconButton>
      <IconButton size="xs" aria-label="Open quest">
        <ChevronIcon />
      </IconButton>
    </div>
}`,...(E=(A=c.parameters)==null?void 0:A.docs)==null?void 0:E.source}}};var F,M,T;p.parameters={...p.parameters,docs:{...(F=p.parameters)==null?void 0:F.docs,source:{originalSource:`{
  name: "Copy Field",
  render: () => <div style={{
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: 4,
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 6,
    width: 320
  }}>
      <code style={{
      flex: 1,
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      padding: "0 8px",
      color: "rgba(0,0,0,0.7)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }}>
        sk-aeqi-7f3c9d2b8a0e1f4c5d6e7f8a9b0c1d2e
      </code>
      <IconButton variant="bordered" aria-label="Copy secret">
        <CopyIcon />
      </IconButton>
    </div>
}`,...(T=(M=p.parameters)==null?void 0:M.docs)==null?void 0:T.source}}};const ie=["Ghost","Bordered","Danger","AllSizes","Disabled","DetailHeader","RowActions","CopyField"];export{i as AllSizes,s as Bordered,p as CopyField,t as Danger,d as DetailHeader,l as Disabled,o as Ghost,c as RowActions,ie as __namedExportsOrder,te as default};
