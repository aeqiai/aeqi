import{j as e}from"./jsx-runtime-D_zvdyIk.js";function s({title:i,actions:l,children:R,variant:o="default",className:d}){const A=o==="detail"?"detail-panel":"dash-panel",w=o==="detail"?"detail-panel-title":"dash-panel-title";return e.jsxs("div",{className:`${A}${d?` ${d}`:""}`,children:[(i||l)&&e.jsxs("div",{className:"dash-panel-header",children:[i&&e.jsx("span",{className:w,children:i}),l]}),R]})}s.displayName="Panel";s.__docgenInfo={description:"",methods:[],displayName:"Panel",props:{title:{required:!1,tsType:{name:"string"},description:""},actions:{required:!1,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""},variant:{required:!1,tsType:{name:"union",raw:'"default" | "detail"',elements:[{name:"literal",value:'"default"'},{name:"literal",value:'"detail"'}]},description:"",defaultValue:{value:'"default"',computed:!1}},className:{required:!1,tsType:{name:"string"},description:""}}};const P={title:"UI/Panel",component:s,tags:["autodocs"],argTypes:{variant:{control:"select",options:["default","detail"]}}},t={args:{title:"Active Quests",children:e.jsx("div",{style:{padding:"16px",color:"var(--color-text-secondary)"},children:"Panel content goes here"})}},a={args:{title:"Recent Activity",actions:e.jsx("a",{href:"#",style:{fontSize:"12px"},children:"View all"}),children:e.jsx("div",{style:{padding:"16px",color:"var(--color-text-secondary)"},children:"Activity items"})}},n={args:{title:"Agent Details",variant:"detail",children:e.jsx("div",{style:{padding:"16px"},children:e.jsx("p",{style:{fontSize:"13px",color:"var(--color-text-secondary)"},children:"Detail panel with additional information about the agent."})})}},r={args:{children:e.jsx("div",{style:{padding:"16px",color:"var(--color-text-secondary)"},children:"Panel without a title"})}};var c,p,u;t.parameters={...t.parameters,docs:{...(c=t.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    title: "Active Quests",
    children: <div style={{
      padding: "16px",
      color: "var(--color-text-secondary)"
    }}>
        Panel content goes here
      </div>
  }
}`,...(u=(p=t.parameters)==null?void 0:p.docs)==null?void 0:u.source}}};var m,h,v;a.parameters={...a.parameters,docs:{...(m=a.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {
    title: "Recent Activity",
    actions: <a href="#" style={{
      fontSize: "12px"
    }}>
        View all
      </a>,
    children: <div style={{
      padding: "16px",
      color: "var(--color-text-secondary)"
    }}>Activity items</div>
  }
}`,...(v=(h=a.parameters)==null?void 0:h.docs)==null?void 0:v.source}}};var x,y,g;n.parameters={...n.parameters,docs:{...(x=n.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    title: "Agent Details",
    variant: "detail",
    children: <div style={{
      padding: "16px"
    }}>
        <p style={{
        fontSize: "13px",
        color: "var(--color-text-secondary)"
      }}>
          Detail panel with additional information about the agent.
        </p>
      </div>
  }
}`,...(g=(y=n.parameters)==null?void 0:y.docs)==null?void 0:g.source}}};var f,j,N;r.parameters={...r.parameters,docs:{...(f=r.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    children: <div style={{
      padding: "16px",
      color: "var(--color-text-secondary)"
    }}>
        Panel without a title
      </div>
  }
}`,...(N=(j=r.parameters)==null?void 0:j.docs)==null?void 0:N.source}}};const S=["Default","WithActions","DetailVariant","NoTitle"];export{t as Default,n as DetailVariant,r as NoTitle,a as WithActions,S as __namedExportsOrder,P as default};
