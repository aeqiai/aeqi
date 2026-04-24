import{j as n}from"./jsx-runtime-D_zvdyIk.js";import{C as e,a as k,b as D}from"./Card-C85S5eq-.js";import{B as V}from"./Button-DVRBRNVW.js";import{S as N,B as A}from"./Badge-CRC_81sh.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const K={title:"Primitives/Containers/Card",component:e,tags:["autodocs"],parameters:{docs:{description:{component:"Container primitive for grouped content. Compose with `CardHeader` / `CardFooter` for structured layouts, or use standalone with `padding` for lightweight surfaces."}}},argTypes:{variant:{control:"select",options:["default","surface","flat"]},padding:{control:"select",options:["none","sm","md","lg"]},interactive:{control:"boolean"}}},r={args:{variant:"default",padding:"md",children:n.jsxs(n.Fragment,{children:[n.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Default card"}),n.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Standard surface over the base background."})]})}},a={args:{variant:"surface",padding:"md",children:n.jsxs(n.Fragment,{children:[n.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Surface card"}),n.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Nested surface — sits on a bg-surface parent."})]})}},t={args:{variant:"flat",padding:"md",children:n.jsxs(n.Fragment,{children:[n.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Flat card"}),n.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Transparent container — border only, no background fill."})]})}},s={args:{interactive:!0,padding:"md",onClick:()=>{},children:n.jsxs(n.Fragment,{children:[n.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Interactive card"}),n.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Hover/focus lift — use for clickable rows and tiles."})]})}},i={name:"Agent Summary",render:()=>n.jsx("div",{style:{maxWidth:360},children:n.jsxs(e,{padding:"none",children:[n.jsx(k,{title:"code-reviewer",actions:n.jsx(N,{status:"active"})}),n.jsx("div",{style:{padding:"12px 16px",fontSize:13,color:"rgba(0,0,0,0.7)"},children:"Reviews pull requests for the aeqi monorepo. Escalates high-risk changes to the CTO agent."}),n.jsxs(D,{children:[n.jsx("span",{style:{fontSize:12,color:"rgba(0,0,0,0.4)"},children:"claude-opus-4 · child of cto"}),n.jsx("div",{style:{flex:1}}),n.jsx(V,{variant:"ghost",size:"sm",children:"View"})]})]})})},o={name:"Quest Card",render:()=>n.jsx("div",{style:{maxWidth:400},children:n.jsxs(e,{padding:"none",interactive:!0,children:[n.jsx(k,{title:n.jsx("span",{style:{fontFamily:"var(--font-mono)",fontSize:12},children:"QST-042 · Migrate payments SDK"}),actions:n.jsx(A,{variant:"warning",children:"high"})}),n.jsx("div",{style:{padding:"8px 16px 14px",fontSize:13,color:"rgba(0,0,0,0.65)"},children:"Swap the deprecated payments client for the new SDK. Remove old dependency once tests pass."}),n.jsxs(D,{children:[n.jsx(N,{status:"in_progress"}),n.jsx("div",{style:{flex:1}}),n.jsx("span",{style:{fontSize:11,color:"rgba(0,0,0,0.35)"},children:"@payments-agent · 2h ago"})]})]})})},d={name:"Stat Tiles",render:()=>n.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:12,maxWidth:600},children:[n.jsxs(e,{variant:"flat",padding:"md",children:[n.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.4)",textTransform:"uppercase"},children:"Active agents"}),n.jsx("div",{style:{fontSize:24,fontWeight:600,marginTop:4,fontVariantNumeric:"tabular-nums"},children:"12"})]}),n.jsxs(e,{variant:"flat",padding:"md",children:[n.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.4)",textTransform:"uppercase"},children:"In-progress"}),n.jsx("div",{style:{fontSize:24,fontWeight:600,marginTop:4,fontVariantNumeric:"tabular-nums"},children:"4"})]}),n.jsxs(e,{variant:"flat",padding:"md",children:[n.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.4)",textTransform:"uppercase"},children:"Cost / day"}),n.jsx("div",{style:{fontSize:24,fontWeight:600,marginTop:4,fontVariantNumeric:"tabular-nums"},children:"$3.42"})]})]})};var c,l,p;r.parameters={...r.parameters,docs:{...(c=r.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    variant: "default",
    padding: "md",
    children: <>
        <h4 style={{
        margin: "0 0 4px",
        fontSize: 14,
        fontWeight: 600
      }}>Default card</h4>
        <p style={{
        margin: 0,
        fontSize: 13,
        color: "rgba(0,0,0,0.6)"
      }}>
          Standard surface over the base background.
        </p>
      </>
  }
}`,...(p=(l=r.parameters)==null?void 0:l.docs)==null?void 0:p.source}}};var g,m,f;a.parameters={...a.parameters,docs:{...(g=a.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    variant: "surface",
    padding: "md",
    children: <>
        <h4 style={{
        margin: "0 0 4px",
        fontSize: 14,
        fontWeight: 600
      }}>Surface card</h4>
        <p style={{
        margin: 0,
        fontSize: 13,
        color: "rgba(0,0,0,0.6)"
      }}>
          Nested surface — sits on a bg-surface parent.
        </p>
      </>
  }
}`,...(f=(m=a.parameters)==null?void 0:m.docs)==null?void 0:f.source}}};var u,h,v;t.parameters={...t.parameters,docs:{...(u=t.parameters)==null?void 0:u.docs,source:{originalSource:`{
  args: {
    variant: "flat",
    padding: "md",
    children: <>
        <h4 style={{
        margin: "0 0 4px",
        fontSize: 14,
        fontWeight: 600
      }}>Flat card</h4>
        <p style={{
        margin: 0,
        fontSize: 13,
        color: "rgba(0,0,0,0.6)"
      }}>
          Transparent container — border only, no background fill.
        </p>
      </>
  }
}`,...(v=(h=t.parameters)==null?void 0:h.docs)==null?void 0:v.source}}};var x,S,y;s.parameters={...s.parameters,docs:{...(x=s.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    interactive: true,
    padding: "md",
    onClick: () => {},
    children: <>
        <h4 style={{
        margin: "0 0 4px",
        fontSize: 14,
        fontWeight: 600
      }}>Interactive card</h4>
        <p style={{
        margin: 0,
        fontSize: 13,
        color: "rgba(0,0,0,0.6)"
      }}>
          Hover/focus lift — use for clickable rows and tiles.
        </p>
      </>
  }
}`,...(y=(S=s.parameters)==null?void 0:S.docs)==null?void 0:y.source}}};var j,b,z;i.parameters={...i.parameters,docs:{...(j=i.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: "Agent Summary",
  render: () => <div style={{
    maxWidth: 360
  }}>
      <Card padding="none">
        <CardHeader title="code-reviewer" actions={<StatusBadge status="active" />} />
        <div style={{
        padding: "12px 16px",
        fontSize: 13,
        color: "rgba(0,0,0,0.7)"
      }}>
          Reviews pull requests for the aeqi monorepo. Escalates high-risk changes to the CTO agent.
        </div>
        <CardFooter>
          <span style={{
          fontSize: 12,
          color: "rgba(0,0,0,0.4)"
        }}>
            claude-opus-4 · child of cto
          </span>
          <div style={{
          flex: 1
        }} />
          <Button variant="ghost" size="sm">
            View
          </Button>
        </CardFooter>
      </Card>
    </div>
}`,...(z=(b=i.parameters)==null?void 0:b.docs)==null?void 0:z.source}}};var C,T,W;o.parameters={...o.parameters,docs:{...(C=o.parameters)==null?void 0:C.docs,source:{originalSource:`{
  name: "Quest Card",
  render: () => <div style={{
    maxWidth: 400
  }}>
      <Card padding="none" interactive>
        <CardHeader title={<span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12
      }}>
              QST-042 · Migrate payments SDK
            </span>} actions={<Badge variant="warning">high</Badge>} />
        <div style={{
        padding: "8px 16px 14px",
        fontSize: 13,
        color: "rgba(0,0,0,0.65)"
      }}>
          Swap the deprecated payments client for the new SDK. Remove old dependency once tests
          pass.
        </div>
        <CardFooter>
          <StatusBadge status="in_progress" />
          <div style={{
          flex: 1
        }} />
          <span style={{
          fontSize: 11,
          color: "rgba(0,0,0,0.35)"
        }}>@payments-agent · 2h ago</span>
        </CardFooter>
      </Card>
    </div>
}`,...(W=(T=o.parameters)==null?void 0:T.docs)==null?void 0:W.source}}};var w,F,B;d.parameters={...d.parameters,docs:{...(w=d.parameters)==null?void 0:w.docs,source:{originalSource:`{
  name: "Stat Tiles",
  render: () => <div style={{
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
    maxWidth: 600
  }}>
      <Card variant="flat" padding="md">
        <div style={{
        fontSize: 11,
        color: "rgba(0,0,0,0.4)",
        textTransform: "uppercase"
      }}>
          Active agents
        </div>
        <div style={{
        fontSize: 24,
        fontWeight: 600,
        marginTop: 4,
        fontVariantNumeric: "tabular-nums"
      }}>
          12
        </div>
      </Card>
      <Card variant="flat" padding="md">
        <div style={{
        fontSize: 11,
        color: "rgba(0,0,0,0.4)",
        textTransform: "uppercase"
      }}>
          In-progress
        </div>
        <div style={{
        fontSize: 24,
        fontWeight: 600,
        marginTop: 4,
        fontVariantNumeric: "tabular-nums"
      }}>
          4
        </div>
      </Card>
      <Card variant="flat" padding="md">
        <div style={{
        fontSize: 11,
        color: "rgba(0,0,0,0.4)",
        textTransform: "uppercase"
      }}>
          Cost / day
        </div>
        <div style={{
        fontSize: 24,
        fontWeight: 600,
        marginTop: 4,
        fontVariantNumeric: "tabular-nums"
      }}>
          $3.42
        </div>
      </Card>
    </div>
}`,...(B=(F=d.parameters)==null?void 0:F.docs)==null?void 0:B.source}}};const _=["Default","Surface","Flat","Interactive","AgentSummary","QuestCard","StatTiles"];export{i as AgentSummary,r as Default,t as Flat,s as Interactive,o as QuestCard,d as StatTiles,a as Surface,_ as __namedExportsOrder,K as default};
