import{j as r}from"./jsx-runtime-D_zvdyIk.js";import{S as n}from"./Stack-DcCu8G-b.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const A={title:"Primitives/Containers/Stack",component:n,tags:["autodocs"],argTypes:{gap:{control:"select",options:["0","1","2","3","4","5","6","8"]},align:{control:"select",options:["start","center","end","stretch"]},as:{control:"select",options:["div","section","ul","ol","li","nav","main","aside","article"]}}};function e({label:o,wide:a}){return r.jsx("div",{style:{padding:"10px 16px",background:"var(--color-slab)",borderRadius:"var(--radius-sm)",fontSize:"var(--font-size-sm)",color:"var(--color-text-secondary)",fontFamily:"var(--font-mono)",width:a?"100%":void 0},children:o??"child"})}const s={render:()=>r.jsxs(n,{children:[r.jsx(e,{label:"first"}),r.jsx(e,{label:"second"}),r.jsx(e,{label:"third"})]})},t={name:"Gap Scale",render:()=>{const o=["1","2","3","4","5","6","8"];return r.jsx("div",{style:{display:"flex",gap:32,alignItems:"flex-start"},children:o.map(a=>r.jsxs("div",{children:[r.jsxs("p",{style:{fontSize:"var(--font-size-xs)",color:"var(--color-text-muted)",fontFamily:"var(--font-mono)",marginBottom:8},children:['gap="',a,'"']}),r.jsxs(n,{gap:a,children:[r.jsx(e,{}),r.jsx(e,{}),r.jsx(e,{})]})]},a))})}},i={name:"Alignment Variants",render:()=>{const o=["start","center","end","stretch"];return r.jsx("div",{style:{display:"flex",gap:32,alignItems:"flex-start"},children:o.map(a=>r.jsxs("div",{style:{width:140},children:[r.jsxs("p",{style:{fontSize:"var(--font-size-xs)",color:"var(--color-text-muted)",fontFamily:"var(--font-mono)",marginBottom:8},children:['align="',a,'"']}),r.jsxs(n,{align:a,style:{background:"var(--color-slab-elevated)",border:"1px solid var(--color-border)",borderRadius:"var(--radius-md)",padding:"var(--space-3)"},children:[r.jsx(e,{label:"short"}),r.jsx(e,{label:"longer label"}),r.jsx(e,{label:"md"})]})]},a))})}},l={name:"Polymorphic — as ul",render:()=>r.jsxs(n,{as:"ul",gap:"2",style:{listStyle:"none",padding:0,margin:0,maxWidth:280},children:[r.jsx("li",{style:{padding:"var(--space-2) var(--space-3)",background:"var(--color-slab)",borderRadius:"var(--radius-sm)",fontSize:"var(--font-size-sm)",color:"var(--color-text-primary)"},children:"Research Lead"}),r.jsx("li",{style:{padding:"var(--space-2) var(--space-3)",background:"var(--color-slab)",borderRadius:"var(--radius-sm)",fontSize:"var(--font-size-sm)",color:"var(--color-text-primary)"},children:"Ops Janitor"}),r.jsx("li",{style:{padding:"var(--space-2) var(--space-3)",background:"var(--color-slab)",borderRadius:"var(--radius-sm)",fontSize:"var(--font-size-sm)",color:"var(--color-text-primary)"},children:"Founder Voice"})]})},d={name:"Real Use Case — Form",render:()=>r.jsxs("div",{style:{maxWidth:360,padding:"var(--space-6)",background:"var(--color-card)",border:"1px solid var(--color-border)",borderRadius:"var(--radius-lg)"},children:[r.jsx("p",{style:{fontSize:"var(--font-size-lg)",fontWeight:"var(--font-weight-semibold)",color:"var(--color-text-title)",marginBottom:"var(--space-5)"},children:"Create Agent"}),r.jsxs(n,{gap:"4",children:[r.jsxs(n,{gap:"1",children:[r.jsx("label",{style:{fontSize:"var(--font-size-xs)",fontWeight:"var(--font-weight-medium)",color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em"},children:"Name"}),r.jsx("div",{style:{height:"var(--input-h, 32px)",background:"var(--color-slab)",borderRadius:"var(--radius-md)",border:"1px solid var(--color-border)"}})]}),r.jsxs(n,{gap:"1",children:[r.jsx("label",{style:{fontSize:"var(--font-size-xs)",fontWeight:"var(--font-weight-medium)",color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em"},children:"Description"}),r.jsx("div",{style:{height:72,background:"var(--color-slab)",borderRadius:"var(--radius-md)",border:"1px solid var(--color-border)"}})]}),r.jsxs("div",{style:{display:"flex",justifyContent:"flex-end",gap:"var(--space-2)",paddingTop:"var(--space-2)",borderTop:"1px solid var(--color-border)"},children:[r.jsx("div",{style:{padding:"0 var(--space-4)",height:"var(--input-h, 32px)",background:"var(--color-slab)",borderRadius:"var(--radius-md)",border:"1px solid var(--color-border)",display:"flex",alignItems:"center",fontSize:"var(--font-size-sm)",color:"var(--color-text-primary)"},children:"Cancel"}),r.jsx("div",{style:{padding:"0 var(--space-4)",height:"var(--input-h, 32px)",background:"var(--color-accent)",borderRadius:"var(--radius-md)",display:"flex",alignItems:"center",fontSize:"var(--font-size-sm)",color:"var(--color-text-on-accent)"},children:"Create Agent"})]})]})]})};var c,p,v;s.parameters={...s.parameters,docs:{...(c=s.parameters)==null?void 0:c.docs,source:{originalSource:`{
  render: () => <Stack>
      <Box label="first" />
      <Box label="second" />
      <Box label="third" />
    </Stack>
}`,...(v=(p=s.parameters)==null?void 0:p.docs)==null?void 0:v.source}}};var m,g,x;t.parameters={...t.parameters,docs:{...(m=t.parameters)==null?void 0:m.docs,source:{originalSource:`{
  name: "Gap Scale",
  render: () => {
    const gaps: SpaceToken[] = ["1", "2", "3", "4", "5", "6", "8"];
    return <div style={{
      display: "flex",
      gap: 32,
      alignItems: "flex-start"
    }}>
        {gaps.map(gap => <div key={gap}>
            <p style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-mono)",
          marginBottom: 8
        }}>
              gap=&quot;{gap}&quot;
            </p>
            <Stack gap={gap}>
              <Box />
              <Box />
              <Box />
            </Stack>
          </div>)}
      </div>;
  }
}`,...(x=(g=t.parameters)==null?void 0:g.docs)==null?void 0:x.source}}};var u,b,f;i.parameters={...i.parameters,docs:{...(u=i.parameters)==null?void 0:u.docs,source:{originalSource:`{
  name: "Alignment Variants",
  render: () => {
    const aligns = ["start", "center", "end", "stretch"] as const;
    return <div style={{
      display: "flex",
      gap: 32,
      alignItems: "flex-start"
    }}>
        {aligns.map(align => <div key={align} style={{
        width: 140
      }}>
            <p style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-mono)",
          marginBottom: 8
        }}>
              align=&quot;{align}&quot;
            </p>
            <Stack align={align} style={{
          background: "var(--color-slab-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3)"
        }}>
              <Box label="short" />
              <Box label="longer label" />
              <Box label="md" />
            </Stack>
          </div>)}
      </div>;
  }
}`,...(f=(b=i.parameters)==null?void 0:b.docs)==null?void 0:f.source}}};var h,y,S;l.parameters={...l.parameters,docs:{...(h=l.parameters)==null?void 0:h.docs,source:{originalSource:`{
  name: "Polymorphic — as ul",
  render: () => <Stack as="ul" gap="2" style={{
    listStyle: "none",
    padding: 0,
    margin: 0,
    maxWidth: 280
  }}>
      <li style={{
      padding: "var(--space-2) var(--space-3)",
      background: "var(--color-slab)",
      borderRadius: "var(--radius-sm)",
      fontSize: "var(--font-size-sm)",
      color: "var(--color-text-primary)"
    }}>
        Research Lead
      </li>
      <li style={{
      padding: "var(--space-2) var(--space-3)",
      background: "var(--color-slab)",
      borderRadius: "var(--radius-sm)",
      fontSize: "var(--font-size-sm)",
      color: "var(--color-text-primary)"
    }}>
        Ops Janitor
      </li>
      <li style={{
      padding: "var(--space-2) var(--space-3)",
      background: "var(--color-slab)",
      borderRadius: "var(--radius-sm)",
      fontSize: "var(--font-size-sm)",
      color: "var(--color-text-primary)"
    }}>
        Founder Voice
      </li>
    </Stack>
}`,...(S=(y=l.parameters)==null?void 0:y.docs)==null?void 0:S.source}}};var z,j,k;d.parameters={...d.parameters,docs:{...(z=d.parameters)==null?void 0:z.docs,source:{originalSource:`{
  name: "Real Use Case — Form",
  render: () => <div style={{
    maxWidth: 360,
    padding: "var(--space-6)",
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)"
  }}>
      <p style={{
      fontSize: "var(--font-size-lg)",
      fontWeight: "var(--font-weight-semibold)",
      color: "var(--color-text-title)",
      marginBottom: "var(--space-5)"
    }}>
        Create Agent
      </p>
      <Stack gap="4">
        {/* Label + input row */}
        <Stack gap="1">
          <label style={{
          fontSize: "var(--font-size-xs)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em"
        }}>
            Name
          </label>
          <div style={{
          height: "var(--input-h, 32px)",
          background: "var(--color-slab)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)"
        }} />
        </Stack>

        {/* Label + textarea row */}
        <Stack gap="1">
          <label style={{
          fontSize: "var(--font-size-xs)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em"
        }}>
            Description
          </label>
          <div style={{
          height: 72,
          background: "var(--color-slab)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)"
        }} />
        </Stack>

        {/* Button bar */}
        <div style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: "var(--space-2)",
        paddingTop: "var(--space-2)",
        borderTop: "1px solid var(--color-border)"
      }}>
          <div style={{
          padding: "0 var(--space-4)",
          height: "var(--input-h, 32px)",
          background: "var(--color-slab)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-primary)"
        }}>
            Cancel
          </div>
          <div style={{
          padding: "0 var(--space-4)",
          height: "var(--input-h, 32px)",
          background: "var(--color-accent)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          alignItems: "center",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-on-accent)"
        }}>
            Create Agent
          </div>
        </div>
      </Stack>
    </div>
}`,...(k=(j=d.parameters)==null?void 0:j.docs)==null?void 0:k.source}}};const T=["Default","GapScale","AlignmentVariants","As","RealUseCase"];export{i as AlignmentVariants,l as As,s as Default,t as GapScale,d as RealUseCase,T as __namedExportsOrder,A as default};
