import{j as s}from"./jsx-runtime-D_zvdyIk.js";const L="_spinner_1c084_1",h="_spin_1c084_1",q="_sm_1c084_9",A="_md_1c084_14",D="_lg_1c084_19",i={spinner:L,spin:h,sm:q,md:A,lg:D};function e({size:I="md",className:N}){return s.jsx("span",{className:[i.spinner,i[I],N].filter(Boolean).join(" "),role:"status","aria-label":"Loading"})}e.displayName="Spinner";e.__docgenInfo={description:"",methods:[],displayName:"Spinner",props:{size:{required:!1,tsType:{name:"union",raw:'"sm" | "md" | "lg"',elements:[{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'},{name:"literal",value:'"lg"'}]},description:"",defaultValue:{value:'"md"',computed:!1}},className:{required:!1,tsType:{name:"string"},description:""}}};const M={title:"UI/Spinner",component:e,tags:["autodocs"],parameters:{layout:"centered"}},r={args:{}},a={args:{size:"sm"}},n={args:{size:"md"}},t={args:{size:"lg"}},o={render:()=>s.jsxs("div",{style:{display:"flex",gap:16,alignItems:"center"},children:[s.jsx(e,{size:"sm"}),s.jsx(e,{size:"md"}),s.jsx(e,{size:"lg"})]})};var m,c,l;r.parameters={...r.parameters,docs:{...(m=r.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {}
}`,...(l=(c=r.parameters)==null?void 0:c.docs)==null?void 0:l.source}}};var p,d,u;a.parameters={...a.parameters,docs:{...(p=a.parameters)==null?void 0:p.docs,source:{originalSource:`{
  args: {
    size: "sm"
  }
}`,...(u=(d=a.parameters)==null?void 0:d.docs)==null?void 0:u.source}}};var g,_,S;n.parameters={...n.parameters,docs:{...(g=n.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    size: "md"
  }
}`,...(S=(_=n.parameters)==null?void 0:_.docs)==null?void 0:S.source}}};var z,f,x;t.parameters={...t.parameters,docs:{...(z=t.parameters)==null?void 0:z.docs,source:{originalSource:`{
  args: {
    size: "lg"
  }
}`,...(x=(f=t.parameters)==null?void 0:f.docs)==null?void 0:x.source}}};var y,j,v;o.parameters={...o.parameters,docs:{...(y=o.parameters)==null?void 0:y.docs,source:{originalSource:`{
  render: () => <div style={{
    display: "flex",
    gap: 16,
    alignItems: "center"
  }}>
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </div>
}`,...(v=(j=o.parameters)==null?void 0:j.docs)==null?void 0:v.source}}};const T=["Default","Small","Medium","Large","AllSizes"];export{o as AllSizes,r as Default,t as Large,n as Medium,a as Small,T as __namedExportsOrder,M as default};
