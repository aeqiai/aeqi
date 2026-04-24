import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{S as n}from"./Spinner-BocUsjO0.js";const T={title:"Primitives/Feedback/Spinner",component:n,tags:["autodocs"],parameters:{layout:"centered"}},r={args:{size:"sm"}},s={args:{size:"md"}},a={args:{size:"lg"}},i={name:"Size Scale",render:()=>e.jsxs("div",{style:{display:"flex",gap:24,alignItems:"center"},children:[e.jsxs("div",{style:{textAlign:"center"},children:[e.jsx(n,{size:"sm"}),e.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.35)",marginTop:8},children:"sm"})]}),e.jsxs("div",{style:{textAlign:"center"},children:[e.jsx(n,{size:"md"}),e.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.35)",marginTop:8},children:"md"})]}),e.jsxs("div",{style:{textAlign:"center"},children:[e.jsx(n,{size:"lg"}),e.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.35)",marginTop:8},children:"lg"})]})]})},t={name:"Inline Loading Pattern",render:()=>e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[e.jsx(n,{size:"sm"}),e.jsx("span",{style:{fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Connecting to agent runtime..."})]})},o={name:"Page Loading Pattern",render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:48,minHeight:200},children:[e.jsx(n,{size:"lg"}),e.jsx("span",{style:{fontSize:13,color:"rgba(0,0,0,0.4)"},children:"Loading dashboard..."})]})};var d,l,c;r.parameters={...r.parameters,docs:{...(d=r.parameters)==null?void 0:d.docs,source:{originalSource:`{
  args: {
    size: "sm"
  }
}`,...(c=(l=r.parameters)==null?void 0:l.docs)==null?void 0:c.source}}};var g,m,p;s.parameters={...s.parameters,docs:{...(g=s.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    size: "md"
  }
}`,...(p=(m=s.parameters)==null?void 0:m.docs)==null?void 0:p.source}}};var x,u,S;a.parameters={...a.parameters,docs:{...(x=a.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    size: "lg"
  }
}`,...(S=(u=a.parameters)==null?void 0:u.docs)==null?void 0:S.source}}};var y,z,v;i.parameters={...i.parameters,docs:{...(y=i.parameters)==null?void 0:y.docs,source:{originalSource:`{
  name: "Size Scale",
  render: () => <div style={{
    display: "flex",
    gap: 24,
    alignItems: "center"
  }}>
      <div style={{
      textAlign: "center"
    }}>
        <Spinner size="sm" />
        <div style={{
        fontSize: 11,
        color: "rgba(0,0,0,0.35)",
        marginTop: 8
      }}>sm</div>
      </div>
      <div style={{
      textAlign: "center"
    }}>
        <Spinner size="md" />
        <div style={{
        fontSize: 11,
        color: "rgba(0,0,0,0.35)",
        marginTop: 8
      }}>md</div>
      </div>
      <div style={{
      textAlign: "center"
    }}>
        <Spinner size="lg" />
        <div style={{
        fontSize: 11,
        color: "rgba(0,0,0,0.35)",
        marginTop: 8
      }}>lg</div>
      </div>
    </div>
}`,...(v=(z=i.parameters)==null?void 0:z.docs)==null?void 0:v.source}}};var f,j,b;t.parameters={...t.parameters,docs:{...(f=t.parameters)==null?void 0:f.docs,source:{originalSource:`{
  name: "Inline Loading Pattern",
  render: () => <div style={{
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
      <Spinner size="sm" />
      <span style={{
      fontSize: 13,
      color: "rgba(0,0,0,0.55)"
    }}>
        Connecting to agent runtime...
      </span>
    </div>
}`,...(b=(j=t.parameters)==null?void 0:j.docs)==null?void 0:b.source}}};var h,L,I;o.parameters={...o.parameters,docs:{...(h=o.parameters)==null?void 0:h.docs,source:{originalSource:`{
  name: "Page Loading Pattern",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 48,
    minHeight: 200
  }}>
      <Spinner size="lg" />
      <span style={{
      fontSize: 13,
      color: "rgba(0,0,0,0.4)"
    }}>Loading dashboard...</span>
    </div>
}`,...(I=(L=o.parameters)==null?void 0:L.docs)==null?void 0:I.source}}};const C=["Small","Medium","Large","AllSizes","InlineLoading","PageLoading"];export{i as AllSizes,t as InlineLoading,a as Large,s as Medium,o as PageLoading,r as Small,C as __namedExportsOrder,T as default};
