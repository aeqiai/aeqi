import{j as n}from"./jsx-runtime-D_zvdyIk.js";import{r as v}from"./index-oxIuDU2I.js";import{S as I}from"./Badge-CRC_81sh.js";import"./_commonjsHelpers-CqkleIqs.js";const D="_tablist_1227p_1",$="_tab_1227p_1",k="_tabpanel_1227p_50",g={tablist:D,tab:$,tabpanel:k};function p({tabs:t,defaultTab:_}){var b;const[o,u]=v.useState(_||((b=t[0])==null?void 0:b.id)||""),i=v.useId();return n.jsxs(n.Fragment,{children:[n.jsx("div",{className:g.tablist,role:"tablist",children:t.map(e=>{const m=o===e.id;return n.jsxs("button",{id:`${i}-tab-${e.id}`,role:"tab","aria-selected":m,"aria-controls":`${i}-panel-${e.id}`,tabIndex:m?0:-1,className:g.tab,onClick:()=>u(e.id),onKeyDown:c=>{const f=t.findIndex(s=>s.id===o);let a=-1;if(c.key==="ArrowRight"&&(a=(f+1)%t.length),c.key==="ArrowLeft"&&(a=(f-1+t.length)%t.length),a>=0){c.preventDefault(),u(t[a].id);const s=document.getElementById(`${i}-tab-${t[a].id}`);s==null||s.focus()}},children:[e.label,e.count!=null?` (${e.count})`:""]},e.id)})}),t.map(e=>n.jsx("div",{id:`${i}-panel-${e.id}`,role:"tabpanel","aria-labelledby":`${i}-tab-${e.id}`,className:g.tabpanel,tabIndex:0,hidden:o!==e.id,children:o===e.id&&e.content},e.id))]})}p.displayName="Tabs";p.__docgenInfo={description:"",methods:[],displayName:"Tabs",props:{tabs:{required:!0,tsType:{name:"Array",elements:[{name:"Tab"}],raw:"Tab[]"},description:""},defaultTab:{required:!1,tsType:{name:"string"},description:""}}};const B={title:"Components/Tabs",component:p,tags:["autodocs"]},d={name:"Agent Detail Tabs",args:{tabs:[{id:"overview",label:"Overview",content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Agent identity, model configuration, and current status."})},{id:"quests",label:"Quests",count:3,content:n.jsx("div",{style:{padding:16,display:"flex",flexDirection:"column",gap:8},children:["Refactor auth module","Write migration script","Review PR #142"].map(t=>n.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(0,0,0,0.06)",fontSize:13},children:[n.jsx("span",{style:{color:"rgba(0,0,0,0.85)"},children:t}),n.jsx(I,{status:"in_progress",size:"sm"})]},t))})},{id:"events",label:"Events",count:142,content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Activity stream for this agent."})},{id:"ideas",label:"Ideas",count:5,content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Knowledge, identity, and instructions attached to this agent."})}]}},r={name:"Quest Filter Tabs",args:{tabs:[{id:"all",label:"All",count:34,content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"All quests across all agents and statuses."})},{id:"active",label:"Active",count:8,content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Quests currently being worked on by agents."})},{id:"blocked",label:"Blocked",count:2,content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Quests that need attention or are waiting on dependencies."})},{id:"done",label:"Done",count:24,content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Completed quests."})}]}},l={name:"Settings Tabs",args:{tabs:[{id:"connection",label:"Connection",content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Daemon endpoint, authentication, and runtime configuration."})},{id:"preferences",label:"Preferences",content:n.jsx("div",{style:{padding:16,fontSize:13,color:"rgba(0,0,0,0.55)"},children:"UI theme, layout preferences, and notification settings."})}]}};var y,x,h;d.parameters={...d.parameters,docs:{...(y=d.parameters)==null?void 0:y.docs,source:{originalSource:`{
  name: "Agent Detail Tabs",
  args: {
    tabs: [{
      id: "overview",
      label: "Overview",
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            Agent identity, model configuration, and current status.
          </div>
    }, {
      id: "quests",
      label: "Quests",
      count: 3,
      content: <div style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}>
            {["Refactor auth module", "Write migration script", "Review PR #142"].map(q => <div key={q} style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 0",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          fontSize: 13
        }}>
                <span style={{
            color: "rgba(0,0,0,0.85)"
          }}>{q}</span>
                <StatusBadge status="in_progress" size="sm" />
              </div>)}
          </div>
    }, {
      id: "events",
      label: "Events",
      count: 142,
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            Activity stream for this agent.
          </div>
    }, {
      id: "ideas",
      label: "Ideas",
      count: 5,
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            Knowledge, identity, and instructions attached to this agent.
          </div>
    }]
  }
}`,...(h=(x=d.parameters)==null?void 0:x.docs)==null?void 0:h.source}}};var S,z,j;r.parameters={...r.parameters,docs:{...(S=r.parameters)==null?void 0:S.docs,source:{originalSource:`{
  name: "Quest Filter Tabs",
  args: {
    tabs: [{
      id: "all",
      label: "All",
      count: 34,
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            All quests across all agents and statuses.
          </div>
    }, {
      id: "active",
      label: "Active",
      count: 8,
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            Quests currently being worked on by agents.
          </div>
    }, {
      id: "blocked",
      label: "Blocked",
      count: 2,
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            Quests that need attention or are waiting on dependencies.
          </div>
    }, {
      id: "done",
      label: "Done",
      count: 24,
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            Completed quests.
          </div>
    }]
  }
}`,...(j=(z=r.parameters)==null?void 0:z.docs)==null?void 0:j.source}}};var T,w,A;l.parameters={...l.parameters,docs:{...(T=l.parameters)==null?void 0:T.docs,source:{originalSource:`{
  name: "Settings Tabs",
  args: {
    tabs: [{
      id: "connection",
      label: "Connection",
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            Daemon endpoint, authentication, and runtime configuration.
          </div>
    }, {
      id: "preferences",
      label: "Preferences",
      content: <div style={{
        padding: 16,
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
            UI theme, layout preferences, and notification settings.
          </div>
    }]
  }
}`,...(A=(w=l.parameters)==null?void 0:w.docs)==null?void 0:A.source}}};const E=["AgentDetailTabs","QuestFilterTabs","SettingsTabs"];export{d as AgentDetailTabs,r as QuestFilterTabs,l as SettingsTabs,E as __namedExportsOrder,B as default};
