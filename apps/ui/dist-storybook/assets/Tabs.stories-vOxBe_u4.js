import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as w}from"./index-JhL3uwfD.js";function l({tabs:d,defaultTab:h}){var o,r;const[a,j]=w.useState(h||((o=d[0])==null?void 0:o.id)||"");return e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"tab-bar",role:"tablist",children:d.map(n=>e.jsxs("button",{role:"tab","aria-selected":a===n.id,className:`btn${a===n.id?" btn-primary":""}`,onClick:()=>j(n.id),children:[n.label,n.count!=null?` (${n.count})`:""]},n.id))}),e.jsx("div",{role:"tabpanel",children:(r=d.find(n=>n.id===a))==null?void 0:r.content})]})}l.displayName="Tabs";l.__docgenInfo={description:"",methods:[],displayName:"Tabs",props:{tabs:{required:!0,tsType:{name:"Array",elements:[{name:"Tab"}],raw:"Tab[]"},description:""},defaultTab:{required:!1,tsType:{name:"string"},description:""}}};const A={title:"UI/Tabs",component:l,tags:["autodocs"]},t={args:{tabs:[{id:"overview",label:"Overview",content:e.jsx("div",{style:{padding:16},children:"Overview content"})},{id:"settings",label:"Settings",content:e.jsx("div",{style:{padding:16},children:"Settings content"})}]}},s={args:{tabs:[{id:"overview",label:"Overview",content:e.jsx("div",{style:{padding:16},children:"Overview"})},{id:"quests",label:"Quests",count:12,content:e.jsx("div",{style:{padding:16},children:"Quests list"})},{id:"events",label:"Events",count:48,content:e.jsx("div",{style:{padding:16},children:"Events stream"})},{id:"ideas",label:"Ideas",count:5,content:e.jsx("div",{style:{padding:16},children:"Ideas"})},{id:"settings",label:"Settings",content:e.jsx("div",{style:{padding:16},children:"Settings"})}]}},i={args:{tabs:[{id:"all",label:"All",count:24,content:e.jsx("div",{style:{padding:16},children:"All items"})},{id:"active",label:"Active",count:8,content:e.jsx("div",{style:{padding:16},children:"Active items"})},{id:"done",label:"Done",count:16,content:e.jsx("div",{style:{padding:16},children:"Done items"})}]}};var c,v,p;t.parameters={...t.parameters,docs:{...(c=t.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    tabs: [{
      id: "overview",
      label: "Overview",
      content: <div style={{
        padding: 16
      }}>Overview content</div>
    }, {
      id: "settings",
      label: "Settings",
      content: <div style={{
        padding: 16
      }}>Settings content</div>
    }]
  }
}`,...(p=(v=t.parameters)==null?void 0:v.docs)==null?void 0:p.source}}};var g,u,m;s.parameters={...s.parameters,docs:{...(g=s.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    tabs: [{
      id: "overview",
      label: "Overview",
      content: <div style={{
        padding: 16
      }}>Overview</div>
    }, {
      id: "quests",
      label: "Quests",
      count: 12,
      content: <div style={{
        padding: 16
      }}>Quests list</div>
    }, {
      id: "events",
      label: "Events",
      count: 48,
      content: <div style={{
        padding: 16
      }}>Events stream</div>
    }, {
      id: "ideas",
      label: "Ideas",
      count: 5,
      content: <div style={{
        padding: 16
      }}>Ideas</div>
    }, {
      id: "settings",
      label: "Settings",
      content: <div style={{
        padding: 16
      }}>Settings</div>
    }]
  }
}`,...(m=(u=s.parameters)==null?void 0:u.docs)==null?void 0:m.source}}};var b,y,x;i.parameters={...i.parameters,docs:{...(b=i.parameters)==null?void 0:b.docs,source:{originalSource:`{
  args: {
    tabs: [{
      id: "all",
      label: "All",
      count: 24,
      content: <div style={{
        padding: 16
      }}>All items</div>
    }, {
      id: "active",
      label: "Active",
      count: 8,
      content: <div style={{
        padding: 16
      }}>Active items</div>
    }, {
      id: "done",
      label: "Done",
      count: 16,
      content: <div style={{
        padding: 16
      }}>Done items</div>
    }]
  }
}`,...(x=(y=i.parameters)==null?void 0:y.docs)==null?void 0:x.source}}};const O=["TwoTabs","FiveTabs","WithCounts"];export{s as FiveTabs,t as TwoTabs,i as WithCounts,O as __namedExportsOrder,A as default};
