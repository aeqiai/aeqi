import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as U}from"./index-oxIuDU2I.js";import{P as t}from"./Popover-Bw-spCWH.js";import{B as n}from"./Button-DVRBRNVW.js";import"./_commonjsHelpers-CqkleIqs.js";const q={title:"Primitives/Overlays/Popover",component:t,tags:["autodocs"]},r=()=>e.jsx("div",{style:{padding:"8px 0"},children:["Option A","Option B","Option C"].map(o=>e.jsx("div",{style:{padding:"6px 14px",fontSize:13,cursor:"pointer",color:"var(--text-primary)"},children:o},o))}),a={name:"Placement: bottom-start",render:()=>e.jsx("div",{style:{padding:40},children:e.jsx(t,{trigger:e.jsx(n,{variant:"secondary",children:"Open"}),placement:"bottom-start",children:e.jsx(r,{})})})},s={name:"Placement: bottom-end",render:()=>e.jsx("div",{style:{padding:40,display:"flex",justifyContent:"flex-end"},children:e.jsx(t,{trigger:e.jsx(n,{variant:"secondary",children:"Open"}),placement:"bottom-end",children:e.jsx(r,{})})})},d={name:"Placement: top-start",render:()=>e.jsx("div",{style:{padding:120,paddingTop:40},children:e.jsx(t,{trigger:e.jsx(n,{variant:"secondary",children:"Open above"}),placement:"top-start",children:e.jsx(r,{})})})},p={name:"Placement: top-end",render:()=>e.jsx("div",{style:{padding:120,display:"flex",justifyContent:"flex-end"},children:e.jsx(t,{trigger:e.jsx(n,{variant:"secondary",children:"Open above"}),placement:"top-end",children:e.jsx(r,{})})})},i={name:"Controlled (open/close from parent)",render:()=>{const[o,c]=U.useState(!1);return e.jsxs("div",{style:{padding:40,display:"flex",flexDirection:"column",gap:16},children:[e.jsxs("div",{style:{display:"flex",gap:8},children:[e.jsx(n,{variant:"primary",onClick:()=>c(!0),children:"Open"}),e.jsx(n,{variant:"ghost",onClick:()=>c(!1),children:"Close"})]}),e.jsx(t,{trigger:e.jsxs(n,{variant:"secondary",children:["Trigger (",o?"open":"closed",")"]}),open:o,onOpenChange:c,placement:"bottom-start",children:e.jsx(r,{})})]})}},l={name:"Uncontrolled (self-managed state)",render:()=>e.jsx("div",{style:{padding:40},children:e.jsx(t,{trigger:e.jsx(n,{variant:"secondary",children:"Toggle me"}),placement:"bottom-start",children:e.jsx(r,{})})})};var m,g,v;a.parameters={...a.parameters,docs:{...(m=a.parameters)==null?void 0:m.docs,source:{originalSource:`{
  name: "Placement: bottom-start",
  render: () => <div style={{
    padding: 40
  }}>
      <Popover trigger={<Button variant="secondary">Open</Button>} placement="bottom-start">
        <SampleContent />
      </Popover>
    </div>
}`,...(v=(g=a.parameters)==null?void 0:g.docs)==null?void 0:v.source}}};var x,u,y;s.parameters={...s.parameters,docs:{...(x=s.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: "Placement: bottom-end",
  render: () => <div style={{
    padding: 40,
    display: "flex",
    justifyContent: "flex-end"
  }}>
      <Popover trigger={<Button variant="secondary">Open</Button>} placement="bottom-end">
        <SampleContent />
      </Popover>
    </div>
}`,...(y=(u=s.parameters)==null?void 0:u.docs)==null?void 0:y.source}}};var j,f,h;d.parameters={...d.parameters,docs:{...(j=d.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: "Placement: top-start",
  render: () => <div style={{
    padding: 120,
    paddingTop: 40
  }}>
      <Popover trigger={<Button variant="secondary">Open above</Button>} placement="top-start">
        <SampleContent />
      </Popover>
    </div>
}`,...(h=(f=d.parameters)==null?void 0:f.docs)==null?void 0:h.source}}};var C,P,B;p.parameters={...p.parameters,docs:{...(C=p.parameters)==null?void 0:C.docs,source:{originalSource:`{
  name: "Placement: top-end",
  render: () => <div style={{
    padding: 120,
    display: "flex",
    justifyContent: "flex-end"
  }}>
      <Popover trigger={<Button variant="secondary">Open above</Button>} placement="top-end">
        <SampleContent />
      </Popover>
    </div>
}`,...(B=(P=p.parameters)==null?void 0:P.docs)==null?void 0:B.source}}};var O,S,b;i.parameters={...i.parameters,docs:{...(O=i.parameters)==null?void 0:O.docs,source:{originalSource:`{
  name: "Controlled (open/close from parent)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = useState(false);
    return <div style={{
      padding: 40,
      display: "flex",
      flexDirection: "column",
      gap: 16
    }}>
        <div style={{
        display: "flex",
        gap: 8
      }}>
          <Button variant="primary" onClick={() => setOpen(true)}>
            Open
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
        <Popover trigger={<Button variant="secondary">Trigger ({open ? "open" : "closed"})</Button>} open={open} onOpenChange={setOpen} placement="bottom-start">
          <SampleContent />
        </Popover>
      </div>;
  }
}`,...(b=(S=i.parameters)==null?void 0:S.docs)==null?void 0:b.source}}};var T,E,k;l.parameters={...l.parameters,docs:{...(T=l.parameters)==null?void 0:T.docs,source:{originalSource:`{
  name: "Uncontrolled (self-managed state)",
  render: () => <div style={{
    padding: 40
  }}>
      <Popover trigger={<Button variant="secondary">Toggle me</Button>} placement="bottom-start">
        <SampleContent />
      </Popover>
    </div>
}`,...(k=(E=l.parameters)==null?void 0:E.docs)==null?void 0:k.source}}};const w=["BottomStart","BottomEnd","TopStart","TopEnd","Controlled","Uncontrolled"];export{s as BottomEnd,a as BottomStart,i as Controlled,p as TopEnd,d as TopStart,l as Uncontrolled,w as __namedExportsOrder,q as default};
