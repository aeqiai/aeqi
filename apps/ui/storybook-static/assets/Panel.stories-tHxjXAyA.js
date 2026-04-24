import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{S as m,B as E}from"./Badge-CRC_81sh.js";import{H}from"./HeroStats-Ay8LoCjN.js";import{B as x}from"./Button-DVRBRNVW.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const L="_panel_1o81a_1",O="_detail_1o81a_10 _panel_1o81a_1",F="_header_1o81a_14",J="_title_1o81a_21",M="_detailTitle_1o81a_27 _title_1o81a_21",s={panel:L,detail:O,header:F,title:J,detailTitle:M};function t({title:a,actions:n,children:u,variant:g="default",className:k}){const C=[g==="detail"?s.detail:s.panel,k].filter(Boolean).join(" "),V=g==="detail"?s.detailTitle:s.title;return e.jsxs("div",{className:C,children:[(a||n)&&e.jsxs("div",{className:s.header,children:[a&&e.jsx("span",{className:V,children:a}),n]}),u]})}t.displayName="Panel";t.__docgenInfo={description:"",methods:[],displayName:"Panel",props:{title:{required:!1,tsType:{name:"string"},description:""},actions:{required:!1,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""},variant:{required:!1,tsType:{name:"union",raw:'"default" | "detail"',elements:[{name:"literal",value:'"default"'},{name:"literal",value:'"detail"'}]},description:"",defaultValue:{value:'"default"',computed:!1}},className:{required:!1,tsType:{name:"string"},description:""}}};const Z={title:"Primitives/Containers/Panel",component:t,tags:["autodocs"],argTypes:{variant:{control:"select",options:["default","detail"]}}},i={args:{title:"Active Quests",children:e.jsx("div",{style:{padding:"16px",color:"rgba(0,0,0,0.55)",fontSize:13},children:"Panel content goes here"})}},l={args:{title:"Agent Details",variant:"detail",children:e.jsx("div",{style:{padding:"16px"},children:e.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.55)"},children:"Detail panel with additional information about the agent."})})}},r={name:"Dashboard Stats Panel",render:()=>e.jsx("div",{style:{maxWidth:600},children:e.jsx(t,{title:"Runtime Overview",children:e.jsx("div",{style:{padding:"8px 16px 16px"},children:e.jsx(H,{stats:[{value:7,label:"Agents",color:"default"},{value:23,label:"Quests",color:"info"},{value:142,label:"Events",color:"muted"},{value:"$18.40",label:"Cost"}]})})})})},o={name:"Quest List Panel",render:()=>{const a=[{name:"Refactor auth module",status:"in_progress",agent:"code-reviewer"},{name:"Write migration script",status:"pending",agent:"---"},{name:"Deploy v0.5.0",status:"blocked",agent:"deploy-agent"},{name:"Update API docs",status:"done",agent:"docs-writer"}];return e.jsx("div",{style:{maxWidth:520},children:e.jsx(t,{title:"Recent Quests",actions:e.jsx("a",{href:"#",style:{fontSize:12,color:"rgba(0,0,0,0.4)",textDecoration:"none"},children:"View all"}),children:e.jsx("div",{style:{display:"flex",flexDirection:"column"},children:a.map((n,u)=>e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",borderTop:u>0?"1px solid rgba(0,0,0,0.06)":void 0},children:[e.jsx("span",{style:{fontSize:13,color:"rgba(0,0,0,0.85)",flex:1},children:n.name}),e.jsx(m,{status:n.status,size:"sm"}),e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:11,color:"rgba(0,0,0,0.35)",minWidth:100,textAlign:"right"},children:n.agent})]},n.name))})})})}},d={name:"Panel with Actions",render:()=>e.jsx("div",{style:{maxWidth:480},children:e.jsx(t,{title:"Agent: code-reviewer",actions:e.jsx("div",{style:{display:"flex",gap:6},children:e.jsx(E,{variant:"success",dot:!0,size:"sm",children:"Active"})}),children:e.jsxs("div",{style:{padding:16},children:[e.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.55)",margin:"0 0 16px"},children:"Reviews pull requests, checks for code quality issues, and suggests improvements based on established patterns."}),e.jsxs("div",{style:{display:"flex",gap:8},children:[e.jsx(x,{variant:"secondary",size:"sm",children:"View Quests"}),e.jsx(x,{variant:"ghost",size:"sm",children:"Edit"})]})]})})})},c={name:"Nested Panels",render:()=>e.jsx("div",{style:{maxWidth:520},children:e.jsx(t,{title:"Agent Hierarchy",children:e.jsx("div",{style:{padding:16,display:"flex",flexDirection:"column",gap:12},children:e.jsx(t,{title:"orchestrator",variant:"detail",children:e.jsxs("div",{style:{padding:"8px 16px"},children:[e.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:0},children:"Root agent. Delegates work to child agents."}),e.jsxs("div",{style:{marginTop:12,display:"flex",flexDirection:"column",gap:8},children:[e.jsx(t,{variant:"detail",children:e.jsxs("div",{style:{padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"},children:[e.jsx("code",{style:{fontSize:12},children:"code-reviewer"}),e.jsx(m,{status:"working",size:"sm"})]})}),e.jsx(t,{variant:"detail",children:e.jsxs("div",{style:{padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"},children:[e.jsx("code",{style:{fontSize:12},children:"test-runner"}),e.jsx(m,{status:"idle",size:"sm"})]})})]})]})})})})})},p={args:{children:e.jsx("div",{style:{padding:"16px",color:"rgba(0,0,0,0.55)",fontSize:13},children:"Panels without titles are useful for grouping content without extra visual weight."})}};var v,h,y;i.parameters={...i.parameters,docs:{...(v=i.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    title: "Active Quests",
    children: <div style={{
      padding: "16px",
      color: "rgba(0,0,0,0.55)",
      fontSize: 13
    }}>
        Panel content goes here
      </div>
  }
}`,...(y=(h=i.parameters)==null?void 0:h.docs)==null?void 0:y.source}}};var f,j,b;l.parameters={...l.parameters,docs:{...(f=l.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    title: "Agent Details",
    variant: "detail",
    children: <div style={{
      padding: "16px"
    }}>
        <p style={{
        fontSize: 13,
        color: "rgba(0,0,0,0.55)"
      }}>
          Detail panel with additional information about the agent.
        </p>
      </div>
  }
}`,...(b=(j=l.parameters)==null?void 0:j.docs)==null?void 0:b.source}}};var S,w,P;r.parameters={...r.parameters,docs:{...(S=r.parameters)==null?void 0:S.docs,source:{originalSource:`{
  name: "Dashboard Stats Panel",
  render: () => <div style={{
    maxWidth: 600
  }}>
      <Panel title="Runtime Overview">
        <div style={{
        padding: "8px 16px 16px"
      }}>
          <HeroStats stats={[{
          value: 7,
          label: "Agents",
          color: "default"
        }, {
          value: 23,
          label: "Quests",
          color: "info"
        }, {
          value: 142,
          label: "Events",
          color: "muted"
        }, {
          value: "$18.40",
          label: "Cost"
        }]} />
        </div>
      </Panel>
    </div>
}`,...(P=(w=r.parameters)==null?void 0:w.docs)==null?void 0:P.source}}};var z,_,D;o.parameters={...o.parameters,docs:{...(z=o.parameters)==null?void 0:z.docs,source:{originalSource:`{
  name: "Quest List Panel",
  render: () => {
    const quests = [{
      name: "Refactor auth module",
      status: "in_progress",
      agent: "code-reviewer"
    }, {
      name: "Write migration script",
      status: "pending",
      agent: "---"
    }, {
      name: "Deploy v0.5.0",
      status: "blocked",
      agent: "deploy-agent"
    }, {
      name: "Update API docs",
      status: "done",
      agent: "docs-writer"
    }];
    return <div style={{
      maxWidth: 520
    }}>
        <Panel title="Recent Quests" actions={<a href="#" style={{
        fontSize: 12,
        color: "rgba(0,0,0,0.4)",
        textDecoration: "none"
      }}>
              View all
            </a>}>
          <div style={{
          display: "flex",
          flexDirection: "column"
        }}>
            {quests.map((q, i) => <div key={q.name} style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            borderTop: i > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined
          }}>
                <span style={{
              fontSize: 13,
              color: "rgba(0,0,0,0.85)",
              flex: 1
            }}>{q.name}</span>
                <StatusBadge status={q.status} size="sm" />
                <code style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 11,
              color: "rgba(0,0,0,0.35)",
              minWidth: 100,
              textAlign: "right"
            }}>
                  {q.agent}
                </code>
              </div>)}
          </div>
        </Panel>
      </div>;
  }
}`,...(D=(_=o.parameters)==null?void 0:_.docs)==null?void 0:D.source}}};var A,R,W;d.parameters={...d.parameters,docs:{...(A=d.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: "Panel with Actions",
  render: () => <div style={{
    maxWidth: 480
  }}>
      <Panel title="Agent: code-reviewer" actions={<div style={{
      display: "flex",
      gap: 6
    }}>
            <Badge variant="success" dot size="sm">
              Active
            </Badge>
          </div>}>
        <div style={{
        padding: 16
      }}>
          <p style={{
          fontSize: 13,
          color: "rgba(0,0,0,0.55)",
          margin: "0 0 16px"
        }}>
            Reviews pull requests, checks for code quality issues, and suggests improvements based
            on established patterns.
          </p>
          <div style={{
          display: "flex",
          gap: 8
        }}>
            <Button variant="secondary" size="sm">
              View Quests
            </Button>
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </div>
        </div>
      </Panel>
    </div>
}`,...(W=(R=d.parameters)==null?void 0:R.docs)==null?void 0:W.source}}};var B,N,T;c.parameters={...c.parameters,docs:{...(B=c.parameters)==null?void 0:B.docs,source:{originalSource:`{
  name: "Nested Panels",
  render: () => <div style={{
    maxWidth: 520
  }}>
      <Panel title="Agent Hierarchy">
        <div style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}>
          <Panel title="orchestrator" variant="detail">
            <div style={{
            padding: "8px 16px"
          }}>
              <p style={{
              fontSize: 12,
              color: "rgba(0,0,0,0.4)",
              margin: 0
            }}>
                Root agent. Delegates work to child agents.
              </p>
              <div style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8
            }}>
                <Panel variant="detail">
                  <div style={{
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}>
                    <code style={{
                    fontSize: 12
                  }}>code-reviewer</code>
                    <StatusBadge status="working" size="sm" />
                  </div>
                </Panel>
                <Panel variant="detail">
                  <div style={{
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}>
                    <code style={{
                    fontSize: 12
                  }}>test-runner</code>
                    <StatusBadge status="idle" size="sm" />
                  </div>
                </Panel>
              </div>
            </div>
          </Panel>
        </div>
      </Panel>
    </div>
}`,...(T=(N=c.parameters)==null?void 0:N.docs)==null?void 0:T.source}}};var q,I,Q;p.parameters={...p.parameters,docs:{...(q=p.parameters)==null?void 0:q.docs,source:{originalSource:`{
  args: {
    children: <div style={{
      padding: "16px",
      color: "rgba(0,0,0,0.55)",
      fontSize: 13
    }}>
        Panels without titles are useful for grouping content without extra visual weight.
      </div>
  }
}`,...(Q=(I=p.parameters)==null?void 0:I.docs)==null?void 0:Q.source}}};const ee=["Default","DetailVariant","WithStats","WithItemList","WithActions","NestedPanels","NoTitle"];export{i as Default,l as DetailVariant,c as NestedPanels,p as NoTitle,d as WithActions,o as WithItemList,r as WithStats,ee as __namedExportsOrder,Z as default};
