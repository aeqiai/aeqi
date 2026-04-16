import{j as a}from"./jsx-runtime-D_zvdyIk.js";import{R as j}from"./index-JhL3uwfD.js";function n({stats:x}){return a.jsx("div",{className:"hero-stats",children:x.map((e,f)=>a.jsxs(j.Fragment,{children:[f>0&&a.jsx("div",{className:"hero-stat-divider"}),a.jsxs("div",{className:"hero-stat",children:[a.jsx("div",{className:`hero-stat-value${e.color&&e.color!=="default"?` ${e.color}`:""}`,children:e.value}),a.jsx("div",{className:"hero-stat-label",children:e.label})]})]},e.label))})}n.displayName="HeroStats";n.__docgenInfo={description:"",methods:[],displayName:"HeroStats",props:{stats:{required:!0,tsType:{name:"Array",elements:[{name:"Stat"}],raw:"Stat[]"},description:""}}};const y={title:"UI/HeroStats",component:n,tags:["autodocs"]},s={args:{stats:[{value:12,label:"Agents"},{value:48,label:"Quests"},{value:156,label:"Events"}]}},l={args:{stats:[{value:5,label:"Active",color:"success"},{value:3,label:"Pending",color:"info"},{value:1,label:"Failed",color:"error"},{value:8,label:"Total",color:"muted"}]}},t={args:{stats:[{value:"$42.50",label:"Total Cost"}]}},r={args:{stats:[{value:24,label:"Agents"},{value:128,label:"Quests"},{value:1024,label:"Events"},{value:"$125.00",label:"Cost"},{value:"99.8%",label:"Uptime",color:"success"}]}};var o,c,u;s.parameters={...s.parameters,docs:{...(o=s.parameters)==null?void 0:o.docs,source:{originalSource:`{
  args: {
    stats: [{
      value: 12,
      label: "Agents"
    }, {
      value: 48,
      label: "Quests"
    }, {
      value: 156,
      label: "Events"
    }]
  }
}`,...(u=(c=s.parameters)==null?void 0:c.docs)==null?void 0:u.source}}};var i,d,m;l.parameters={...l.parameters,docs:{...(i=l.parameters)==null?void 0:i.docs,source:{originalSource:`{
  args: {
    stats: [{
      value: 5,
      label: "Active",
      color: "success"
    }, {
      value: 3,
      label: "Pending",
      color: "info"
    }, {
      value: 1,
      label: "Failed",
      color: "error"
    }, {
      value: 8,
      label: "Total",
      color: "muted"
    }]
  }
}`,...(m=(d=l.parameters)==null?void 0:d.docs)==null?void 0:m.source}}};var v,p,b;t.parameters={...t.parameters,docs:{...(v=t.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    stats: [{
      value: "$42.50",
      label: "Total Cost"
    }]
  }
}`,...(b=(p=t.parameters)==null?void 0:p.docs)==null?void 0:b.source}}};var g,S,h;r.parameters={...r.parameters,docs:{...(g=r.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    stats: [{
      value: 24,
      label: "Agents"
    }, {
      value: 128,
      label: "Quests"
    }, {
      value: 1024,
      label: "Events"
    }, {
      value: "$125.00",
      label: "Cost"
    }, {
      value: "99.8%",
      label: "Uptime",
      color: "success"
    }]
  }
}`,...(h=(S=r.parameters)==null?void 0:S.docs)==null?void 0:h.source}}};const C=["WithStats","ColoredStats","SingleStat","ManyStats"];export{l as ColoredStats,r as ManyStats,t as SingleStat,s as WithStats,C as __namedExportsOrder,y as default};
