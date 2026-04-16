import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{B as D}from"./Badge-3krT-XEc.js";function a({label:j,children:S}){return e.jsxs("div",{className:"detail-field",children:[e.jsx("div",{className:"detail-field-label",children:j}),e.jsx("div",{className:"detail-field-value",children:S})]})}a.displayName="DetailField";a.__docgenInfo={description:"",methods:[],displayName:"DetailField",props:{label:{required:!0,tsType:{name:"string"},description:""},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};const A={title:"UI/DetailField",component:a,tags:["autodocs"]},s={args:{label:"Agent Name",children:"code-reviewer"}},t={args:{label:"Status",children:e.jsx(D,{variant:"success",dot:!0,children:"Active"})}},r={args:{label:"Description",children:"A specialized agent that reviews pull requests, checks for code quality issues, and suggests improvements based on established patterns."}},n={args:{label:"Model",children:e.jsx("code",{style:{fontFamily:"var(--font-mono)",fontSize:"var(--font-size-sm)"},children:"claude-3-opus-20240229"})}},l={render:()=>e.jsxs("div",{style:{maxWidth:400},children:[e.jsx(a,{label:"Name",children:"build-agent"}),e.jsx(a,{label:"Status",children:e.jsx(D,{variant:"success",dot:!0,children:"Active"})}),e.jsx(a,{label:"Model",children:e.jsx("code",{style:{fontFamily:"var(--font-mono)",fontSize:"var(--font-size-sm)"},children:"claude-3-opus"})}),e.jsx(a,{label:"Created",children:"2024-03-15 14:30 UTC"})]})};var i,o,d;s.parameters={...s.parameters,docs:{...(i=s.parameters)==null?void 0:i.docs,source:{originalSource:`{
  args: {
    label: "Agent Name",
    children: "code-reviewer"
  }
}`,...(d=(o=s.parameters)==null?void 0:o.docs)==null?void 0:d.source}}};var c,u,m;t.parameters={...t.parameters,docs:{...(c=t.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    label: "Status",
    children: <Badge variant="success" dot>
        Active
      </Badge>
  }
}`,...(m=(u=t.parameters)==null?void 0:u.docs)==null?void 0:m.source}}};var p,g,h;r.parameters={...r.parameters,docs:{...(p=r.parameters)==null?void 0:p.docs,source:{originalSource:`{
  args: {
    label: "Description",
    children: "A specialized agent that reviews pull requests, checks for code quality issues, and suggests improvements based on established patterns."
  }
}`,...(h=(g=r.parameters)==null?void 0:g.docs)==null?void 0:h.source}}};var v,f,b;n.parameters={...n.parameters,docs:{...(v=n.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    label: "Model",
    children: <code style={{
      fontFamily: "var(--font-mono)",
      fontSize: "var(--font-size-sm)"
    }}>
        claude-3-opus-20240229
      </code>
  }
}`,...(b=(f=n.parameters)==null?void 0:f.docs)==null?void 0:b.source}}};var x,F,y;l.parameters={...l.parameters,docs:{...(x=l.parameters)==null?void 0:x.docs,source:{originalSource:`{
  render: () => <div style={{
    maxWidth: 400
  }}>
      <DetailField label="Name">build-agent</DetailField>
      <DetailField label="Status">
        <Badge variant="success" dot>
          Active
        </Badge>
      </DetailField>
      <DetailField label="Model">
        <code style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--font-size-sm)"
      }}>
          claude-3-opus
        </code>
      </DetailField>
      <DetailField label="Created">2024-03-15 14:30 UTC</DetailField>
    </div>
}`,...(y=(F=l.parameters)==null?void 0:F.docs)==null?void 0:y.source}}};const B=["Default","WithBadge","WithLongText","WithMonoText","MultipleFields"];export{s as Default,l as MultipleFields,t as WithBadge,r as WithLongText,n as WithMonoText,B as __namedExportsOrder,A as default};
