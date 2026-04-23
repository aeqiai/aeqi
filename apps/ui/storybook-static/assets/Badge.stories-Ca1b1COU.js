import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{B as f,S as s}from"./Badge-CRC_81sh.js";const ee={title:"Components/Badge",component:f,tags:["autodocs"],argTypes:{variant:{control:"select",options:["neutral","info","success","warning","error","muted","accent"]},size:{control:"select",options:["sm","md"]}}},r={args:{children:"Idle",variant:"neutral",dot:!0}},t={args:{children:"Active",variant:"success",dot:!0}},n={args:{children:"Working",variant:"accent",dot:!0}},o={args:{children:"Failed",variant:"error",dot:!0}},i={args:{children:"Blocked",variant:"warning",dot:!0}},c={args:{children:"In Progress",variant:"info",dot:!0}},d={args:{children:"Offline",variant:"muted",dot:!0}},l={name:"Agent Status Indicators",render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:16},children:[e.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:0,textTransform:"uppercase",letterSpacing:"0.05em"},children:"Agent lifecycle states"}),e.jsxs("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[e.jsx(s,{status:"idle"}),e.jsx(s,{status:"working"}),e.jsx(s,{status:"offline"})]})]})},u={name:"Quest Status Badges",render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:16},children:[e.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:0,textTransform:"uppercase",letterSpacing:"0.05em"},children:"Quest lifecycle states"}),e.jsxs("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[e.jsx(s,{status:"pending"}),e.jsx(s,{status:"in_progress"}),e.jsx(s,{status:"done"}),e.jsx(s,{status:"blocked"}),e.jsx(s,{status:"failed"}),e.jsx(s,{status:"cancelled"})]})]})},p={name:"Dashboard Status Row",render:()=>e.jsx("div",{style:{display:"flex",flexDirection:"column",gap:12,maxWidth:480},children:[{name:"code-reviewer",status:"working",quest:"Review PR #142"},{name:"deploy-agent",status:"idle",quest:"---"},{name:"test-runner",status:"working",quest:"Run integration suite"},{name:"docs-writer",status:"offline",quest:"---"}].map(a=>e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:13,color:"rgba(0,0,0,0.85)",minWidth:120},children:a.name}),e.jsx(s,{status:a.status,size:"sm"}),e.jsx("span",{style:{marginLeft:"auto",fontSize:12,color:"rgba(0,0,0,0.4)"},children:a.quest})]},a.name))})},m={name:"Size Comparison",render:()=>e.jsxs("div",{style:{display:"flex",gap:12,alignItems:"center"},children:[e.jsx(f,{variant:"success",dot:!0,size:"sm",children:"sm"}),e.jsx(f,{variant:"success",dot:!0,size:"md",children:"md"})]})},g={name:"Without Dot",args:{children:"v0.5.0",variant:"neutral"}};var x,v,S;r.parameters={...r.parameters,docs:{...(x=r.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    children: "Idle",
    variant: "neutral",
    dot: true
  }
}`,...(S=(v=r.parameters)==null?void 0:v.docs)==null?void 0:S.source}}};var y,h,j;t.parameters={...t.parameters,docs:{...(y=t.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    children: "Active",
    variant: "success",
    dot: true
  }
}`,...(j=(h=t.parameters)==null?void 0:h.docs)==null?void 0:j.source}}};var B,w,b;n.parameters={...n.parameters,docs:{...(B=n.parameters)==null?void 0:B.docs,source:{originalSource:`{
  args: {
    children: "Working",
    variant: "accent",
    dot: true
  }
}`,...(b=(w=n.parameters)==null?void 0:w.docs)==null?void 0:b.source}}};var z,D,W;o.parameters={...o.parameters,docs:{...(z=o.parameters)==null?void 0:z.docs,source:{originalSource:`{
  args: {
    children: "Failed",
    variant: "error",
    dot: true
  }
}`,...(W=(D=o.parameters)==null?void 0:D.docs)==null?void 0:W.source}}};var k,R,I;i.parameters={...i.parameters,docs:{...(k=i.parameters)==null?void 0:k.docs,source:{originalSource:`{
  args: {
    children: "Blocked",
    variant: "warning",
    dot: true
  }
}`,...(I=(R=i.parameters)==null?void 0:R.docs)==null?void 0:I.source}}};var q,A,P;c.parameters={...c.parameters,docs:{...(q=c.parameters)==null?void 0:q.docs,source:{originalSource:`{
  args: {
    children: "In Progress",
    variant: "info",
    dot: true
  }
}`,...(P=(A=c.parameters)==null?void 0:A.docs)==null?void 0:P.source}}};var Q,C,T;d.parameters={...d.parameters,docs:{...(Q=d.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  args: {
    children: "Offline",
    variant: "muted",
    dot: true
  }
}`,...(T=(C=d.parameters)==null?void 0:C.docs)==null?void 0:T.source}}};var E,F,M;l.parameters={...l.parameters,docs:{...(E=l.parameters)==null?void 0:E.docs,source:{originalSource:`{
  name: "Agent Status Indicators",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    gap: 16
  }}>
      <p style={{
      fontSize: 12,
      color: "rgba(0,0,0,0.4)",
      margin: 0,
      textTransform: "uppercase",
      letterSpacing: "0.05em"
    }}>
        Agent lifecycle states
      </p>
      <div style={{
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }}>
        <StatusBadge status="idle" />
        <StatusBadge status="working" />
        <StatusBadge status="offline" />
      </div>
    </div>
}`,...(M=(F=l.parameters)==null?void 0:F.docs)==null?void 0:M.source}}};var N,_,O;u.parameters={...u.parameters,docs:{...(N=u.parameters)==null?void 0:N.docs,source:{originalSource:`{
  name: "Quest Status Badges",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    gap: 16
  }}>
      <p style={{
      fontSize: 12,
      color: "rgba(0,0,0,0.4)",
      margin: 0,
      textTransform: "uppercase",
      letterSpacing: "0.05em"
    }}>
        Quest lifecycle states
      </p>
      <div style={{
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }}>
        <StatusBadge status="pending" />
        <StatusBadge status="in_progress" />
        <StatusBadge status="done" />
        <StatusBadge status="blocked" />
        <StatusBadge status="failed" />
        <StatusBadge status="cancelled" />
      </div>
    </div>
}`,...(O=(_=u.parameters)==null?void 0:_.docs)==null?void 0:O.source}}};var J,L,G;p.parameters={...p.parameters,docs:{...(J=p.parameters)==null?void 0:J.docs,source:{originalSource:`{
  name: "Dashboard Status Row",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxWidth: 480
  }}>
      {[{
      name: "code-reviewer",
      status: "working" as const,
      quest: "Review PR #142"
    }, {
      name: "deploy-agent",
      status: "idle" as const,
      quest: "---"
    }, {
      name: "test-runner",
      status: "working" as const,
      quest: "Run integration suite"
    }, {
      name: "docs-writer",
      status: "offline" as const,
      quest: "---"
    }].map(agent => <div key={agent.name} style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 14px",
      border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 8
    }}>
          <code style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: 13,
        color: "rgba(0,0,0,0.85)",
        minWidth: 120
      }}>
            {agent.name}
          </code>
          <StatusBadge status={agent.status} size="sm" />
          <span style={{
        marginLeft: "auto",
        fontSize: 12,
        color: "rgba(0,0,0,0.4)"
      }}>
            {agent.quest}
          </span>
        </div>)}
    </div>
}`,...(G=(L=p.parameters)==null?void 0:L.docs)==null?void 0:G.source}}};var H,K,U;m.parameters={...m.parameters,docs:{...(H=m.parameters)==null?void 0:H.docs,source:{originalSource:`{
  name: "Size Comparison",
  render: () => <div style={{
    display: "flex",
    gap: 12,
    alignItems: "center"
  }}>
      <Badge variant="success" dot size="sm">
        sm
      </Badge>
      <Badge variant="success" dot size="md">
        md
      </Badge>
    </div>
}`,...(U=(K=m.parameters)==null?void 0:K.docs)==null?void 0:U.source}}};var V,X,Y;g.parameters={...g.parameters,docs:{...(V=g.parameters)==null?void 0:V.docs,source:{originalSource:`{
  name: "Without Dot",
  args: {
    children: "v0.5.0",
    variant: "neutral"
  }
}`,...(Y=(X=g.parameters)==null?void 0:X.docs)==null?void 0:Y.source}}};const se=["Neutral","Success","Accent","Error","Warning","Info","Muted","AgentStatus","QuestPriority","DashboardStatusRow","SizeComparison","NoDot"];export{n as Accent,l as AgentStatus,p as DashboardStatusRow,o as Error,c as Info,d as Muted,r as Neutral,g as NoDot,u as QuestPriority,m as SizeComparison,t as Success,i as Warning,se as __namedExportsOrder,ee as default};
