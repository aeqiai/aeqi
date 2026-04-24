import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as L}from"./index-oxIuDU2I.js";import{B as O}from"./Button-DVRBRNVW.js";import{S as D,B as P}from"./Badge-CRC_81sh.js";import"./_commonjsHelpers-CqkleIqs.js";const $="_card_1bmb7_6",U="_surface_1bmb7_20",G="_flat_1bmb7_24",J="_padSm_1bmb7_32",X="_padMd_1bmb7_36",Y="_padLg_1bmb7_40",Z="_padNone_1bmb7_44",ee="_interactive_1bmb7_50",ne="_header_1bmb7_70",ae="_title_1bmb7_78",te="_footer_1bmb7_85",n={card:$,default:"_default_1bmb7_16",surface:U,flat:G,padSm:J,padMd:X,padLg:Y,padNone:Z,interactive:ee,header:ne,title:ae,footer:te},a=L.forwardRef(function({variant:r="default",padding:s="md",interactive:f=!1,className:H,children:A,...M},Q){const E=s==="none"?n.padNone:s==="sm"?n.padSm:s==="lg"?n.padLg:n.padMd,K=[n.card,n[r],E,f?n.interactive:"",H].filter(Boolean).join(" ");return e.jsx("div",{ref:Q,className:K,...M,children:A})});a.displayName="Card";function u({title:t,actions:r,className:s,children:f}){return e.jsxs("div",{className:[n.header,s].filter(Boolean).join(" "),children:[t&&e.jsx("span",{className:n.title,children:t}),f,r]})}function g({className:t,children:r}){return e.jsx("div",{className:[n.footer,t].filter(Boolean).join(" "),children:r})}a.__docgenInfo={description:"",methods:[],displayName:"Card",props:{variant:{required:!1,tsType:{name:"union",raw:'"default" | "surface" | "flat"',elements:[{name:"literal",value:'"default"'},{name:"literal",value:'"surface"'},{name:"literal",value:'"flat"'}]},description:"Background: default (bg-base), surface (bg-surface nested), flat (transparent).",defaultValue:{value:'"default"',computed:!1}},padding:{required:!1,tsType:{name:"union",raw:'"none" | "sm" | "md" | "lg"',elements:[{name:"literal",value:'"none"'},{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'},{name:"literal",value:'"lg"'}]},description:'Padding step. Use "none" when composing with CardHeader/Body/Footer.',defaultValue:{value:'"md"',computed:!1}},interactive:{required:!1,tsType:{name:"boolean"},description:`Hover/focus lift for clickable cards. Does NOT make the card a button —
 if you need keyboard/click semantics, wrap in <button> or use IconButton.`,defaultValue:{value:"false",computed:!1}}}};u.__docgenInfo={description:"",methods:[],displayName:"CardHeader",props:{title:{required:!1,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""},actions:{required:!1,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""},className:{required:!1,tsType:{name:"string"},description:""},children:{required:!1,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};g.__docgenInfo={description:"",methods:[],displayName:"CardFooter",props:{className:{required:!1,tsType:{name:"string"},description:""},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};const ce={title:"Primitives/Containers/Card",component:a,tags:["autodocs"],parameters:{docs:{description:{component:"Container primitive for grouped content. Compose with `CardHeader` / `CardFooter` for structured layouts, or use standalone with `padding` for lightweight surfaces."}}},argTypes:{variant:{control:"select",options:["default","surface","flat"]},padding:{control:"select",options:["none","sm","md","lg"]},interactive:{control:"boolean"}}},i={args:{variant:"default",padding:"md",children:e.jsxs(e.Fragment,{children:[e.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Default card"}),e.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Standard surface over the base background."})]})}},o={args:{variant:"surface",padding:"md",children:e.jsxs(e.Fragment,{children:[e.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Surface card"}),e.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Nested surface — sits on a bg-surface parent."})]})}},d={args:{variant:"flat",padding:"md",children:e.jsxs(e.Fragment,{children:[e.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Flat card"}),e.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Transparent container — border only, no background fill."})]})}},c={args:{interactive:!0,padding:"md",onClick:()=>{},children:e.jsxs(e.Fragment,{children:[e.jsx("h4",{style:{margin:"0 0 4px",fontSize:14,fontWeight:600},children:"Interactive card"}),e.jsx("p",{style:{margin:0,fontSize:13,color:"rgba(0,0,0,0.6)"},children:"Hover/focus lift — use for clickable rows and tiles."})]})}},l={name:"Agent Summary",render:()=>e.jsx("div",{style:{maxWidth:360},children:e.jsxs(a,{padding:"none",children:[e.jsx(u,{title:"code-reviewer",actions:e.jsx(D,{status:"active"})}),e.jsx("div",{style:{padding:"12px 16px",fontSize:13,color:"rgba(0,0,0,0.7)"},children:"Reviews pull requests for the aeqi monorepo. Escalates high-risk changes to the CTO agent."}),e.jsxs(g,{children:[e.jsx("span",{style:{fontSize:12,color:"rgba(0,0,0,0.4)"},children:"claude-opus-4 · child of cto"}),e.jsx("div",{style:{flex:1}}),e.jsx(O,{variant:"ghost",size:"sm",children:"View"})]})]})})},p={name:"Quest Card",render:()=>e.jsx("div",{style:{maxWidth:400},children:e.jsxs(a,{padding:"none",interactive:!0,children:[e.jsx(u,{title:e.jsx("span",{style:{fontFamily:"var(--font-mono)",fontSize:12},children:"QST-042 · Migrate payments SDK"}),actions:e.jsx(P,{variant:"warning",children:"high"})}),e.jsx("div",{style:{padding:"8px 16px 14px",fontSize:13,color:"rgba(0,0,0,0.65)"},children:"Swap the deprecated payments client for the new SDK. Remove old dependency once tests pass."}),e.jsxs(g,{children:[e.jsx(D,{status:"in_progress"}),e.jsx("div",{style:{flex:1}}),e.jsx("span",{style:{fontSize:11,color:"rgba(0,0,0,0.35)"},children:"@payments-agent · 2h ago"})]})]})})},m={name:"Stat Tiles",render:()=>e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:12,maxWidth:600},children:[e.jsxs(a,{variant:"flat",padding:"md",children:[e.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.4)",textTransform:"uppercase"},children:"Active agents"}),e.jsx("div",{style:{fontSize:24,fontWeight:600,marginTop:4,fontVariantNumeric:"tabular-nums"},children:"12"})]}),e.jsxs(a,{variant:"flat",padding:"md",children:[e.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.4)",textTransform:"uppercase"},children:"In-progress"}),e.jsx("div",{style:{fontSize:24,fontWeight:600,marginTop:4,fontVariantNumeric:"tabular-nums"},children:"4"})]}),e.jsxs(a,{variant:"flat",padding:"md",children:[e.jsx("div",{style:{fontSize:11,color:"rgba(0,0,0,0.4)",textTransform:"uppercase"},children:"Cost / day"}),e.jsx("div",{style:{fontSize:24,fontWeight:600,marginTop:4,fontVariantNumeric:"tabular-nums"},children:"$3.42"})]})]})};var h,v,y;i.parameters={...i.parameters,docs:{...(h=i.parameters)==null?void 0:h.docs,source:{originalSource:`{
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
}`,...(y=(v=i.parameters)==null?void 0:v.docs)==null?void 0:y.source}}};var x,S,b;o.parameters={...o.parameters,docs:{...(x=o.parameters)==null?void 0:x.docs,source:{originalSource:`{
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
}`,...(b=(S=o.parameters)==null?void 0:S.docs)==null?void 0:b.source}}};var j,_,C;d.parameters={...d.parameters,docs:{...(j=d.parameters)==null?void 0:j.docs,source:{originalSource:`{
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
}`,...(C=(_=d.parameters)==null?void 0:_.docs)==null?void 0:C.source}}};var z,T,N;c.parameters={...c.parameters,docs:{...(z=c.parameters)==null?void 0:z.docs,source:{originalSource:`{
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
}`,...(N=(T=c.parameters)==null?void 0:T.docs)==null?void 0:N.source}}};var w,R,W;l.parameters={...l.parameters,docs:{...(w=l.parameters)==null?void 0:w.docs,source:{originalSource:`{
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
}`,...(W=(R=l.parameters)==null?void 0:R.docs)==null?void 0:W.source}}};var F,B,k;p.parameters={...p.parameters,docs:{...(F=p.parameters)==null?void 0:F.docs,source:{originalSource:`{
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
}`,...(k=(B=p.parameters)==null?void 0:B.docs)==null?void 0:k.source}}};var q,V,I;m.parameters={...m.parameters,docs:{...(q=m.parameters)==null?void 0:q.docs,source:{originalSource:`{
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
}`,...(I=(V=m.parameters)==null?void 0:V.docs)==null?void 0:I.source}}};const le=["Default","Surface","Flat","Interactive","AgentSummary","QuestCard","StatTiles"];export{l as AgentSummary,i as Default,d as Flat,c as Interactive,p as QuestCard,m as StatTiles,o as Surface,le as __namedExportsOrder,ce as default};
