import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{I as n}from"./IconButton-Xaaos3g3.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";function r(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M4 4l8 8M12 4l-8 8",strokeLinecap:"round"})})}function H(){return e.jsxs("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:[e.jsx("rect",{x:"5",y:"5",width:"9",height:"9",rx:"1.5"}),e.jsx("path",{d:"M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"})]})}function x(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4l.8 9a1 1 0 0 0 1 .9h2.4a1 1 0 0 0 1-.9L11 4"})})}function L(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M11 2l3 3-8 8H3v-3z",strokeLinejoin:"round"})})}function O(){return e.jsx("svg",{viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:e.jsx("path",{d:"M6 4l4 4-4 4",strokeLinecap:"round",strokeLinejoin:"round"})})}const _={title:"Primitives/Actions/IconButton",component:n,tags:["autodocs"],parameters:{docs:{description:{component:"Icon-only button primitive for dense toolbars, detail panels, and row actions. Requires `aria-label` — an icon without a name is a button nobody can read with assistive tech."}}},argTypes:{variant:{control:"select",options:["ghost","bordered","danger"]},size:{control:"select",options:["xs","sm","md"]}},args:{"aria-label":"Example action",children:e.jsx(r,{})}},a={args:{variant:"ghost","aria-label":"Close panel",children:e.jsx(r,{})}},o={args:{variant:"bordered","aria-label":"Copy value",children:e.jsx(H,{})}},s={args:{variant:"danger","aria-label":"Delete",children:e.jsx(x,{})}},t={name:"Size Scale",render:p=>e.jsxs("div",{style:{display:"flex",gap:8,alignItems:"center"},children:[e.jsx(n,{...p,size:"xs","aria-label":"Close (xs)",children:e.jsx(r,{})}),e.jsx(n,{...p,size:"sm","aria-label":"Close (sm)",children:e.jsx(r,{})}),e.jsx(n,{...p,size:"md","aria-label":"Close (md)",children:e.jsx(r,{})})]})},i={args:{disabled:!0,"aria-label":"Delete",children:e.jsx(x,{})}},l={name:"Detail Panel Header",render:()=>e.jsxs("div",{style:{width:320,padding:"12px 14px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"},children:[e.jsx("code",{style:{fontFamily:"var(--font-mono)",fontSize:13,fontWeight:600},children:"onboarding-skill"}),e.jsx(n,{"aria-label":"Close detail",children:e.jsx(r,{})})]})},d={name:"Row Action Cluster",render:()=>e.jsxs("div",{style:{width:360,padding:"10px 12px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,display:"flex",alignItems:"center",gap:12},children:[e.jsx("span",{style:{flex:1,fontSize:13},children:"quest-42 · Ship the rebrand"}),e.jsx(n,{size:"xs","aria-label":"Edit quest",children:e.jsx(L,{})}),e.jsx(n,{size:"xs",variant:"danger","aria-label":"Delete quest",children:e.jsx(x,{})}),e.jsx(n,{size:"xs","aria-label":"Open quest",children:e.jsx(O,{})})]})},c={name:"Copy Field",render:()=>e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:6,padding:4,border:"1px solid rgba(0,0,0,0.08)",borderRadius:6,width:320},children:[e.jsx("code",{style:{flex:1,fontFamily:"var(--font-mono)",fontSize:12,padding:"0 8px",color:"rgba(0,0,0,0.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:"sk-aeqi-7f3c9d2b8a0e1f4c5d6e7f8a9b0c1d2e"}),e.jsx(n,{variant:"bordered","aria-label":"Copy secret",children:e.jsx(H,{})})]})};var u,m,h;a.parameters={...a.parameters,docs:{...(u=a.parameters)==null?void 0:u.docs,source:{originalSource:`{
  args: {
    variant: "ghost",
    "aria-label": "Close panel",
    children: <CloseIcon />
  }
}`,...(h=(m=a.parameters)==null?void 0:m.docs)==null?void 0:h.source}}};var g,b,f;o.parameters={...o.parameters,docs:{...(g=o.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    variant: "bordered",
    "aria-label": "Copy value",
    children: <CopyIcon />
  }
}`,...(f=(b=o.parameters)==null?void 0:b.docs)==null?void 0:f.source}}};var v,j,I;s.parameters={...s.parameters,docs:{...(v=s.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    variant: "danger",
    "aria-label": "Delete",
    children: <TrashIcon />
  }
}`,...(I=(j=s.parameters)==null?void 0:j.docs)==null?void 0:I.source}}};var y,C,w;t.parameters={...t.parameters,docs:{...(y=t.parameters)==null?void 0:y.docs,source:{originalSource:`{
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
}`,...(w=(C=t.parameters)==null?void 0:C.docs)==null?void 0:w.source}}};var B,z,S;i.parameters={...i.parameters,docs:{...(B=i.parameters)==null?void 0:B.docs,source:{originalSource:`{
  args: {
    disabled: true,
    "aria-label": "Delete",
    children: <TrashIcon />
  }
}`,...(S=(z=i.parameters)==null?void 0:z.docs)==null?void 0:S.source}}};var k,D,R;l.parameters={...l.parameters,docs:{...(k=l.parameters)==null?void 0:k.docs,source:{originalSource:`{
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
}`,...(R=(D=l.parameters)==null?void 0:D.docs)==null?void 0:R.source}}};var q,A,F;d.parameters={...d.parameters,docs:{...(q=d.parameters)==null?void 0:q.docs,source:{originalSource:`{
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
}`,...(F=(A=d.parameters)==null?void 0:A.docs)==null?void 0:F.source}}};var M,E,W;c.parameters={...c.parameters,docs:{...(M=c.parameters)==null?void 0:M.docs,source:{originalSource:`{
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
}`,...(W=(E=c.parameters)==null?void 0:E.docs)==null?void 0:W.source}}};const J=["Ghost","Bordered","Danger","AllSizes","Disabled","DetailHeader","RowActions","CopyField"];export{t as AllSizes,o as Bordered,c as CopyField,s as Danger,l as DetailHeader,i as Disabled,a as Ghost,d as RowActions,J as __namedExportsOrder,_ as default};
