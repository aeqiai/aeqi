import{j as t}from"./jsx-runtime-D_zvdyIk.js";import{T as e}from"./Tooltip-ChM8MXiH.js";import{B as o}from"./Button-DVRBRNVW.js";import{B as H}from"./Badge-CRC_81sh.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const N={title:"Components/Tooltip",component:e,tags:["autodocs"],parameters:{layout:"centered"},decorators:[W=>t.jsx("div",{style:{padding:80},children:t.jsx(W,{})})]},n={args:{content:"View agent details",position:"top",children:t.jsx(o,{variant:"secondary",children:"Hover me"})}},r={args:{content:"Open event stream",position:"bottom",children:t.jsx(o,{variant:"secondary",children:"Hover me"})}},s={args:{content:"Previous quest",position:"left",children:t.jsx(o,{variant:"ghost",children:"Hover me"})}},i={args:{content:"Next quest",position:"right",children:t.jsx(o,{variant:"ghost",children:"Hover me"})}},a={name:"Toolbar with Tooltips",render:()=>t.jsxs("div",{style:{display:"flex",gap:4,padding:"8px 12px",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[t.jsx(e,{content:"New quest",position:"bottom",children:t.jsx(o,{variant:"ghost",size:"sm",children:t.jsx("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:t.jsx("path",{d:"M7 1v12M1 7h12"})})})}),t.jsx(e,{content:"Refresh agents",position:"bottom",children:t.jsx(o,{variant:"ghost",size:"sm",children:t.jsx("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:t.jsx("path",{d:"M1 7a6 6 0 0111.196-3M13 7A6 6 0 011.804 10"})})})}),t.jsx(e,{content:"View event log",position:"bottom",children:t.jsx(o,{variant:"ghost",size:"sm",children:t.jsxs("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:[t.jsx("rect",{x:"1",y:"1",width:"12",height:"12",rx:"2"}),t.jsx("path",{d:"M4 5h6M4 7.5h4M4 10h5"})]})})})]})},d={name:"Tooltip on Badge",render:()=>t.jsx(e,{content:"Agent has been working for 2h 34m",position:"top",children:t.jsx("span",{children:t.jsx(H,{variant:"accent",dot:!0,children:"Working"})})})};var c,p,h;n.parameters={...n.parameters,docs:{...(c=n.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    content: "View agent details",
    position: "top",
    children: <Button variant="secondary">Hover me</Button>
  }
}`,...(h=(p=n.parameters)==null?void 0:p.docs)==null?void 0:h.source}}};var l,g,m;r.parameters={...r.parameters,docs:{...(l=r.parameters)==null?void 0:l.docs,source:{originalSource:`{
  args: {
    content: "Open event stream",
    position: "bottom",
    children: <Button variant="secondary">Hover me</Button>
  }
}`,...(m=(g=r.parameters)==null?void 0:g.docs)==null?void 0:m.source}}};var u,v,x;s.parameters={...s.parameters,docs:{...(u=s.parameters)==null?void 0:u.docs,source:{originalSource:`{
  args: {
    content: "Previous quest",
    position: "left",
    children: <Button variant="ghost">Hover me</Button>
  }
}`,...(x=(v=s.parameters)==null?void 0:v.docs)==null?void 0:x.source}}};var B,j,T;i.parameters={...i.parameters,docs:{...(B=i.parameters)==null?void 0:B.docs,source:{originalSource:`{
  args: {
    content: "Next quest",
    position: "right",
    children: <Button variant="ghost">Hover me</Button>
  }
}`,...(T=(j=i.parameters)==null?void 0:j.docs)==null?void 0:T.source}}};var w,f,b;a.parameters={...a.parameters,docs:{...(w=a.parameters)==null?void 0:w.docs,source:{originalSource:`{
  name: "Toolbar with Tooltips",
  render: () => <div style={{
    display: "flex",
    gap: 4,
    padding: "8px 12px",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
      <Tooltip content="New quest" position="bottom">
        <Button variant="ghost" size="sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 1v12M1 7h12" />
          </svg>
        </Button>
      </Tooltip>
      <Tooltip content="Refresh agents" position="bottom">
        <Button variant="ghost" size="sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 7a6 6 0 0111.196-3M13 7A6 6 0 011.804 10" />
          </svg>
        </Button>
      </Tooltip>
      <Tooltip content="View event log" position="bottom">
        <Button variant="ghost" size="sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="12" height="12" rx="2" />
            <path d="M4 5h6M4 7.5h4M4 10h5" />
          </svg>
        </Button>
      </Tooltip>
    </div>
}`,...(b=(f=a.parameters)==null?void 0:f.docs)==null?void 0:b.source}}};var k,M,y;d.parameters={...d.parameters,docs:{...(k=d.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: "Tooltip on Badge",
  render: () => <Tooltip content="Agent has been working for 2h 34m" position="top">
      <span>
        <Badge variant="accent" dot>
          Working
        </Badge>
      </span>
    </Tooltip>
}`,...(y=(M=d.parameters)==null?void 0:M.docs)==null?void 0:y.source}}};const V=["Top","Bottom","Left","Right","ToolbarWithTooltips","BadgeTooltip"];export{d as BadgeTooltip,r as Bottom,s as Left,i as Right,a as ToolbarWithTooltips,n as Top,V as __namedExportsOrder,N as default};
