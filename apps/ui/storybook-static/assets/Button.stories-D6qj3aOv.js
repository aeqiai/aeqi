import{j as n}from"./jsx-runtime-D_zvdyIk.js";import{r as U}from"./index-oxIuDU2I.js";import{B as e}from"./Button-DVRBRNVW.js";import{T as X}from"./Tooltip-ChM8MXiH.js";import"./_commonjsHelpers-CqkleIqs.js";const an={title:"Components/Button",component:e,tags:["autodocs"],argTypes:{variant:{control:"select",options:["primary","secondary","ghost","danger"]},size:{control:"select",options:["sm","md","lg"]}}},r={args:{children:"Create Quest",variant:"primary"}},a={args:{children:"View Details",variant:"secondary"}},t={args:{children:"Cancel",variant:"ghost"}},s={args:{children:"Delete Agent",variant:"danger"}},i={name:"Size Scale",render:()=>n.jsxs("div",{style:{display:"flex",gap:12,alignItems:"center"},children:[n.jsx(e,{size:"sm",variant:"secondary",children:"sm"}),n.jsx(e,{size:"md",variant:"secondary",children:"md"}),n.jsx(e,{size:"lg",variant:"secondary",children:"lg"})]})},o={args:{children:"Cannot Submit",variant:"primary",disabled:!0}},d={args:{children:"Deploying...",variant:"primary",loading:!0}};function Y(){const[g,u]=U.useState(!1);function J(){u(!0),setTimeout(()=>u(!1),2e3)}return n.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:12,maxWidth:280},children:[n.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.55)",margin:0},children:"Click to simulate a 2-second async operation."}),n.jsx(e,{variant:"primary",loading:g,onClick:J,children:g?"Saving quest...":"Save Quest"})]})}const c={name:"Loading State Transition",render:()=>n.jsx(Y,{})},l={name:"Toolbar Pattern",render:()=>n.jsxs("div",{style:{display:"flex",gap:8,alignItems:"center",padding:"12px 16px",borderBottom:"1px solid rgba(0,0,0,0.08)"},children:[n.jsxs(e,{variant:"primary",size:"sm",children:[n.jsx("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:n.jsx("path",{d:"M7 1v12M1 7h12"})}),"New Quest"]}),n.jsx(e,{variant:"secondary",size:"sm",children:"Assign Agent"}),n.jsx("div",{style:{flex:1}}),n.jsx(e,{variant:"ghost",size:"sm",children:"Refresh"}),n.jsx(X,{content:"View event stream",position:"bottom",children:n.jsx(e,{variant:"ghost",size:"sm",children:"Events"})})]})},p={name:"Form Submit / Cancel",render:()=>n.jsxs("div",{style:{maxWidth:400,padding:24,border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[n.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.55)",margin:"0 0 20px"},children:"Configure the agent's identity and capabilities before deployment."}),n.jsxs("div",{style:{display:"flex",gap:8,justifyContent:"flex-end",borderTop:"1px solid rgba(0,0,0,0.08)",paddingTop:16},children:[n.jsx(e,{variant:"ghost",children:"Cancel"}),n.jsx(e,{variant:"primary",children:"Create Agent"})]})]})},m={name:"Button Group",render:()=>n.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:24},children:[n.jsxs("div",{children:[n.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:"0 0 8px",textTransform:"uppercase",letterSpacing:"0.05em"},children:"Quest actions"}),n.jsxs("div",{style:{display:"flex",gap:8},children:[n.jsx(e,{variant:"primary",size:"sm",children:"Start"}),n.jsx(e,{variant:"secondary",size:"sm",children:"Pause"}),n.jsx(e,{variant:"ghost",size:"sm",children:"Archive"}),n.jsx(e,{variant:"danger",size:"sm",children:"Cancel"})]})]}),n.jsxs("div",{children:[n.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:"0 0 8px",textTransform:"uppercase",letterSpacing:"0.05em"},children:"Destructive confirmation"}),n.jsxs("div",{style:{display:"flex",gap:8},children:[n.jsx(e,{variant:"ghost",children:"Keep Agent"}),n.jsx(e,{variant:"danger",children:"Delete Agent"})]})]})]})};var v,x,h;r.parameters={...r.parameters,docs:{...(v=r.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    children: "Create Quest",
    variant: "primary"
  }
}`,...(h=(x=r.parameters)==null?void 0:x.docs)==null?void 0:h.source}}};var y,f,B;a.parameters={...a.parameters,docs:{...(y=a.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    children: "View Details",
    variant: "secondary"
  }
}`,...(B=(f=a.parameters)==null?void 0:f.docs)==null?void 0:B.source}}};var S,b,j;t.parameters={...t.parameters,docs:{...(S=t.parameters)==null?void 0:S.docs,source:{originalSource:`{
  args: {
    children: "Cancel",
    variant: "ghost"
  }
}`,...(j=(b=t.parameters)==null?void 0:b.docs)==null?void 0:j.source}}};var z,C,T;s.parameters={...s.parameters,docs:{...(z=s.parameters)==null?void 0:z.docs,source:{originalSource:`{
  args: {
    children: "Delete Agent",
    variant: "danger"
  }
}`,...(T=(C=s.parameters)==null?void 0:C.docs)==null?void 0:T.source}}};var A,D,w;i.parameters={...i.parameters,docs:{...(A=i.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: "Size Scale",
  render: () => <div style={{
    display: "flex",
    gap: 12,
    alignItems: "center"
  }}>
      <Button size="sm" variant="secondary">
        sm
      </Button>
      <Button size="md" variant="secondary">
        md
      </Button>
      <Button size="lg" variant="secondary">
        lg
      </Button>
    </div>
}`,...(w=(D=i.parameters)==null?void 0:D.docs)==null?void 0:w.source}}};var L,k,Q;o.parameters={...o.parameters,docs:{...(L=o.parameters)==null?void 0:L.docs,source:{originalSource:`{
  args: {
    children: "Cannot Submit",
    variant: "primary",
    disabled: true
  }
}`,...(Q=(k=o.parameters)==null?void 0:k.docs)==null?void 0:Q.source}}};var G,P,E;d.parameters={...d.parameters,docs:{...(G=d.parameters)==null?void 0:G.docs,source:{originalSource:`{
  args: {
    children: "Deploying...",
    variant: "primary",
    loading: true
  }
}`,...(E=(P=d.parameters)==null?void 0:P.docs)==null?void 0:E.source}}};var R,W,F;c.parameters={...c.parameters,docs:{...(R=c.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: "Loading State Transition",
  render: () => <LoadingTransitionDemo />
}`,...(F=(W=c.parameters)==null?void 0:W.docs)==null?void 0:F.source}}};var I,M,V;l.parameters={...l.parameters,docs:{...(I=l.parameters)==null?void 0:I.docs,source:{originalSource:`{
  name: "Toolbar Pattern",
  render: () => <div style={{
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid rgba(0,0,0,0.08)"
  }}>
      <Button variant="primary" size="sm">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M7 1v12M1 7h12" />
        </svg>
        New Quest
      </Button>
      <Button variant="secondary" size="sm">
        Assign Agent
      </Button>
      <div style={{
      flex: 1
    }} />
      <Button variant="ghost" size="sm">
        Refresh
      </Button>
      <Tooltip content="View event stream" position="bottom">
        <Button variant="ghost" size="sm">
          Events
        </Button>
      </Tooltip>
    </div>
}`,...(V=(M=l.parameters)==null?void 0:M.docs)==null?void 0:V.source}}};var K,N,_;p.parameters={...p.parameters,docs:{...(K=p.parameters)==null?void 0:K.docs,source:{originalSource:`{
  name: "Form Submit / Cancel",
  render: () => <div style={{
    maxWidth: 400,
    padding: 24,
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
      <p style={{
      fontSize: 13,
      color: "rgba(0,0,0,0.55)",
      margin: "0 0 20px"
    }}>
        Configure the agent&apos;s identity and capabilities before deployment.
      </p>
      <div style={{
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
}`,...(_=(N=p.parameters)==null?void 0:N.docs)==null?void 0:_.source}}};var q,O,H;m.parameters={...m.parameters,docs:{...(q=m.parameters)==null?void 0:q.docs,source:{originalSource:`{
  name: "Button Group",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    gap: 24
  }}>
      <div>
        <p style={{
        fontSize: 12,
        color: "rgba(0,0,0,0.4)",
        margin: "0 0 8px",
        textTransform: "uppercase",
        letterSpacing: "0.05em"
      }}>
          Quest actions
        </p>
        <div style={{
        display: "flex",
        gap: 8
      }}>
          <Button variant="primary" size="sm">
            Start
          </Button>
          <Button variant="secondary" size="sm">
            Pause
          </Button>
          <Button variant="ghost" size="sm">
            Archive
          </Button>
          <Button variant="danger" size="sm">
            Cancel
          </Button>
        </div>
      </div>
      <div>
        <p style={{
        fontSize: 12,
        color: "rgba(0,0,0,0.4)",
        margin: "0 0 8px",
        textTransform: "uppercase",
        letterSpacing: "0.05em"
      }}>
          Destructive confirmation
        </p>
        <div style={{
        display: "flex",
        gap: 8
      }}>
          <Button variant="ghost">Keep Agent</Button>
          <Button variant="danger">Delete Agent</Button>
        </div>
      </div>
    </div>
}`,...(H=(O=m.parameters)==null?void 0:O.docs)==null?void 0:H.source}}};const tn=["Primary","Secondary","Ghost","Danger","AllSizes","Disabled","Loading","LoadingTransition","AgentToolbar","FormActions","ButtonGroup"];export{l as AgentToolbar,i as AllSizes,m as ButtonGroup,s as Danger,o as Disabled,p as FormActions,t as Ghost,d as Loading,c as LoadingTransition,r as Primary,a as Secondary,tn as __namedExportsOrder,an as default};
