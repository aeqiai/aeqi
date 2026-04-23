import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{I as n}from"./Input-h7Zn72JC.js";import{B as p}from"./Button-DVRBRNVW.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const k={title:"Components/Input",component:n,tags:["autodocs"]},r={args:{placeholder:"Enter value..."}},a={args:{label:"Agent Name",placeholder:"my-agent"}},t={args:{label:"Agent Slug",placeholder:"code-reviewer",hint:"Lowercase letters, numbers, and hyphens only"}},o={args:{label:"Agent Name",value:"Invalid Name!",error:"Name must contain only lowercase letters, numbers, and hyphens"}},s={args:{label:"Runtime ID",value:"rt-8f3a2b1c",disabled:!0}},l={name:"Agent Creation Form",render:()=>e.jsxs("div",{style:{maxWidth:420,padding:24,border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[e.jsx("h3",{style:{fontSize:16,fontWeight:600,color:"rgba(0,0,0,0.85)",margin:"0 0 4px"},children:"Create Agent"}),e.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.4)",margin:"0 0 20px"},children:"Define a new autonomous agent in your runtime."}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:14},children:[e.jsx(n,{label:"Name",placeholder:"code-reviewer",hint:"Unique identifier for this agent"}),e.jsx(n,{label:"Model",placeholder:"claude-3-opus"}),e.jsx(n,{label:"Identity",placeholder:"You are a code review agent that..."}),e.jsx(n,{label:"Parent Agent",placeholder:"orchestrator",hint:"Optional parent in the hierarchy"})]}),e.jsxs("div",{style:{marginTop:24,display:"flex",gap:8,justifyContent:"flex-end",borderTop:"1px solid rgba(0,0,0,0.08)",paddingTop:16},children:[e.jsx(p,{variant:"ghost",children:"Cancel"}),e.jsx(p,{variant:"primary",children:"Create Agent"})]})]})},i={name:"Search Pattern",render:()=>e.jsx("div",{style:{maxWidth:360},children:e.jsxs("div",{style:{position:"relative"},children:[e.jsx(n,{placeholder:"Search quests, agents, ideas..."}),e.jsx("span",{style:{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"rgba(0,0,0,0.3)",fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",padding:"2px 6px",border:"1px solid rgba(0,0,0,0.1)",borderRadius:4},children:"Cmd+K"})]})})},d={name:"Settings Form",render:()=>e.jsxs("div",{style:{maxWidth:420,padding:24,border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[e.jsx("h3",{style:{fontSize:16,fontWeight:600,color:"rgba(0,0,0,0.85)",margin:"0 0 16px"},children:"Daemon Settings"}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:14},children:[e.jsx(n,{label:"API Endpoint",value:"http://localhost:8400"}),e.jsx(n,{label:"API Key",placeholder:"sk-...",hint:"Your key is stored locally"}),e.jsx(n,{label:"Max Concurrent Quests",value:"5",hint:"Limit parallel agent execution"}),e.jsx(n,{label:"Runtime ID",value:"rt-8f3a2b1c",disabled:!0})]}),e.jsx("div",{style:{marginTop:24,display:"flex",gap:8,justifyContent:"flex-end"},children:e.jsx(p,{variant:"primary",children:"Save Changes"})})]})};var c,m,u;r.parameters={...r.parameters,docs:{...(c=r.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    placeholder: "Enter value..."
  }
}`,...(u=(m=r.parameters)==null?void 0:m.docs)==null?void 0:u.source}}};var g,h,b;a.parameters={...a.parameters,docs:{...(g=a.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    label: "Agent Name",
    placeholder: "my-agent"
  }
}`,...(b=(h=a.parameters)==null?void 0:h.docs)==null?void 0:b.source}}};var x,y,v;t.parameters={...t.parameters,docs:{...(x=t.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    label: "Agent Slug",
    placeholder: "code-reviewer",
    hint: "Lowercase letters, numbers, and hyphens only"
  }
}`,...(v=(y=t.parameters)==null?void 0:y.docs)==null?void 0:v.source}}};var f,S,j;o.parameters={...o.parameters,docs:{...(f=o.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    label: "Agent Name",
    value: "Invalid Name!",
    error: "Name must contain only lowercase letters, numbers, and hyphens"
  }
}`,...(j=(S=o.parameters)==null?void 0:S.docs)==null?void 0:j.source}}};var I,C,A;s.parameters={...s.parameters,docs:{...(I=s.parameters)==null?void 0:I.docs,source:{originalSource:`{
  args: {
    label: "Runtime ID",
    value: "rt-8f3a2b1c",
    disabled: true
  }
}`,...(A=(C=s.parameters)==null?void 0:C.docs)==null?void 0:A.source}}};var D,W,w;l.parameters={...l.parameters,docs:{...(D=l.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: "Agent Creation Form",
  render: () => <div style={{
    maxWidth: 420,
    padding: 24,
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
      <h3 style={{
      fontSize: 16,
      fontWeight: 600,
      color: "rgba(0,0,0,0.85)",
      margin: "0 0 4px"
    }}>
        Create Agent
      </h3>
      <p style={{
      fontSize: 13,
      color: "rgba(0,0,0,0.4)",
      margin: "0 0 20px"
    }}>
        Define a new autonomous agent in your runtime.
      </p>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 14
    }}>
        <Input label="Name" placeholder="code-reviewer" hint="Unique identifier for this agent" />
        <Input label="Model" placeholder="claude-3-opus" />
        <Input label="Identity" placeholder="You are a code review agent that..." />
        <Input label="Parent Agent" placeholder="orchestrator" hint="Optional parent in the hierarchy" />
      </div>
      <div style={{
      marginTop: 24,
      display: "flex",
      gap: 8,
      justifyContent: "flex-end",
      borderTop: "1px solid rgba(0,0,0,0.08)",
      paddingTop: 16
    }}>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Create Agent</Button>
      </div>
    </div>
}`,...(w=(W=l.parameters)==null?void 0:W.docs)==null?void 0:w.source}}};var R,B,F;i.parameters={...i.parameters,docs:{...(R=i.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: "Search Pattern",
  render: () => <div style={{
    maxWidth: 360
  }}>
      <div style={{
      position: "relative"
    }}>
        <Input placeholder="Search quests, agents, ideas..." />
        <span style={{
        position: "absolute",
        right: 12,
        top: "50%",
        transform: "translateY(-50%)",
        fontSize: 11,
        color: "rgba(0,0,0,0.3)",
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        padding: "2px 6px",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 4
      }}>
          Cmd+K
        </span>
      </div>
    </div>
}`,...(F=(B=i.parameters)==null?void 0:B.docs)==null?void 0:F.source}}};var N,z,E;d.parameters={...d.parameters,docs:{...(N=d.parameters)==null?void 0:N.docs,source:{originalSource:`{
  name: "Settings Form",
  render: () => <div style={{
    maxWidth: 420,
    padding: 24,
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
      <h3 style={{
      fontSize: 16,
      fontWeight: 600,
      color: "rgba(0,0,0,0.85)",
      margin: "0 0 16px"
    }}>
        Daemon Settings
      </h3>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 14
    }}>
        <Input label="API Endpoint" value="http://localhost:8400" />
        <Input label="API Key" placeholder="sk-..." hint="Your key is stored locally" />
        <Input label="Max Concurrent Quests" value="5" hint="Limit parallel agent execution" />
        <Input label="Runtime ID" value="rt-8f3a2b1c" disabled />
      </div>
      <div style={{
      marginTop: 24,
      display: "flex",
      gap: 8,
      justifyContent: "flex-end"
    }}>
        <Button variant="primary">Save Changes</Button>
      </div>
    </div>
}`,...(E=(z=d.parameters)==null?void 0:z.docs)==null?void 0:E.source}}};const q=["Default","WithLabel","WithHint","WithError","Disabled","AgentCreationForm","SearchInput","SettingsForm"];export{l as AgentCreationForm,r as Default,s as Disabled,i as SearchInput,d as SettingsForm,o as WithError,t as WithHint,a as WithLabel,q as __namedExportsOrder,k as default};
