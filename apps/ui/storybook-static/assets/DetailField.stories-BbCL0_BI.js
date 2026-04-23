import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{D as a}from"./DetailField-DULnf8lh.js";import{S as y,B as S}from"./Badge-CRC_81sh.js";import{T as j}from"./TagList-CJ8UwDj8.js";const C={title:"Components/DetailField",component:a,tags:["autodocs"]},t={args:{label:"Agent Name",children:"code-reviewer"}},o={args:{label:"Status",children:e.jsx(S,{variant:"success",dot:!0,children:"Active"})}},r={name:"With Monospace Value",args:{label:"Model",children:e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:"var(--font-size-sm, 13px)"},children:"claude-3-opus"})}},l={name:"Agent Detail Card",render:()=>e.jsxs("div",{style:{maxWidth:400,padding:20,border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[e.jsx("h3",{style:{fontSize:14,fontWeight:600,color:"rgba(0,0,0,0.85)",margin:"0 0 16px"},children:"Agent Details"}),e.jsx(a,{label:"Name",children:e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:13},children:"code-reviewer"})}),e.jsx(a,{label:"Status",children:e.jsx(y,{status:"working",size:"sm"})}),e.jsx(a,{label:"Model",children:e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:12},children:"claude-3-opus"})}),e.jsx(a,{label:"Parent",children:e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:12},children:"orchestrator"})}),e.jsx(a,{label:"Active Quests",children:"3"}),e.jsx(a,{label:"Total Events",children:"142"}),e.jsx(a,{label:"Expertise",children:e.jsx(j,{items:["typescript","react","code-review"]})}),e.jsx(a,{label:"Created",children:"2026-04-10 09:15 UTC"})]})},i={name:"Quest Detail Card",render:()=>e.jsxs("div",{style:{maxWidth:400,padding:20,border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[e.jsx("h3",{style:{fontSize:14,fontWeight:600,color:"rgba(0,0,0,0.85)",margin:"0 0 16px"},children:"Quest Details"}),e.jsx(a,{label:"Title",children:"Refactor auth module"}),e.jsx(a,{label:"Status",children:e.jsx(y,{status:"in_progress",size:"sm"})}),e.jsx(a,{label:"Assigned Agent",children:e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:12},children:"code-reviewer"})}),e.jsx(a,{label:"Description",children:"Extract JWT validation into a shared middleware. Update all route handlers to use the new pattern."}),e.jsx(a,{label:"Worktree",children:e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:12},children:"/tmp/aeqi/worktrees/quest-8f3a"})}),e.jsx(a,{label:"Created",children:"2026-04-14 16:42 UTC"})]})};var s,n,d;t.parameters={...t.parameters,docs:{...(s=t.parameters)==null?void 0:s.docs,source:{originalSource:`{
  args: {
    label: "Agent Name",
    children: "code-reviewer"
  }
}`,...(d=(n=t.parameters)==null?void 0:n.docs)==null?void 0:d.source}}};var c,m,p;o.parameters={...o.parameters,docs:{...(c=o.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    label: "Status",
    children: <Badge variant="success" dot>
        Active
      </Badge>
  }
}`,...(p=(m=o.parameters)==null?void 0:m.docs)==null?void 0:p.source}}};var u,h,g;r.parameters={...r.parameters,docs:{...(u=r.parameters)==null?void 0:u.docs,source:{originalSource:`{
  name: "With Monospace Value",
  args: {
    label: "Model",
    children: <code style={{
      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
      fontSize: "var(--font-size-sm, 13px)"
    }}>
        claude-3-opus
      </code>
  }
}`,...(g=(h=r.parameters)==null?void 0:h.docs)==null?void 0:g.source}}};var f,x,b;l.parameters={...l.parameters,docs:{...(f=l.parameters)==null?void 0:f.docs,source:{originalSource:`{
  name: "Agent Detail Card",
  render: () => <div style={{
    maxWidth: 400,
    padding: 20,
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
      <h3 style={{
      fontSize: 14,
      fontWeight: 600,
      color: "rgba(0,0,0,0.85)",
      margin: "0 0 16px"
    }}>
        Agent Details
      </h3>
      <DetailField label="Name">
        <code style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: 13
      }}>
          code-reviewer
        </code>
      </DetailField>
      <DetailField label="Status">
        <StatusBadge status="working" size="sm" />
      </DetailField>
      <DetailField label="Model">
        <code style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: 12
      }}>
          claude-3-opus
        </code>
      </DetailField>
      <DetailField label="Parent">
        <code style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: 12
      }}>
          orchestrator
        </code>
      </DetailField>
      <DetailField label="Active Quests">3</DetailField>
      <DetailField label="Total Events">142</DetailField>
      <DetailField label="Expertise">
        <TagList items={["typescript", "react", "code-review"]} />
      </DetailField>
      <DetailField label="Created">2026-04-10 09:15 UTC</DetailField>
    </div>
}`,...(b=(x=l.parameters)==null?void 0:x.docs)==null?void 0:b.source}}};var D,F,v;i.parameters={...i.parameters,docs:{...(D=i.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: "Quest Detail Card",
  render: () => <div style={{
    maxWidth: 400,
    padding: 20,
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
      <h3 style={{
      fontSize: 14,
      fontWeight: 600,
      color: "rgba(0,0,0,0.85)",
      margin: "0 0 16px"
    }}>
        Quest Details
      </h3>
      <DetailField label="Title">Refactor auth module</DetailField>
      <DetailField label="Status">
        <StatusBadge status="in_progress" size="sm" />
      </DetailField>
      <DetailField label="Assigned Agent">
        <code style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: 12
      }}>
          code-reviewer
        </code>
      </DetailField>
      <DetailField label="Description">
        Extract JWT validation into a shared middleware. Update all route handlers to use the new
        pattern.
      </DetailField>
      <DetailField label="Worktree">
        <code style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: 12
      }}>
          /tmp/aeqi/worktrees/quest-8f3a
        </code>
      </DetailField>
      <DetailField label="Created">2026-04-14 16:42 UTC</DetailField>
    </div>
}`,...(v=(F=i.parameters)==null?void 0:F.docs)==null?void 0:v.source}}};const w=["Default","WithBadge","WithMonoText","AgentDetailCard","QuestDetailCard"];export{l as AgentDetailCard,t as Default,i as QuestDetailCard,o as WithBadge,r as WithMonoText,w as __namedExportsOrder,C as default};
