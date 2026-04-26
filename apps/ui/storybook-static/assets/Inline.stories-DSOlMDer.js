import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{I as o}from"./Inline-BcwiYuLf.js";import"./index-oxIuDU2I.js";import"./_commonjsHelpers-CqkleIqs.js";const T={title:"Primitives/Containers/Inline",component:o,tags:["autodocs"],argTypes:{gap:{control:"select",options:["0","1","2","3","4","5","6","8"]},align:{control:"select",options:["start","center","end","baseline","stretch"]},justify:{control:"select",options:["start","center","end","between","around"]},wrap:{control:"boolean"},as:{control:"select",options:["div","section","ul","ol","li","nav","header","footer"]}}};function a({label:r}){return e.jsx("div",{style:{padding:"6px 12px",background:"var(--color-slab)",borderRadius:"var(--radius-sm)",fontSize:"var(--font-size-sm)",color:"var(--color-text-secondary)",fontFamily:"var(--font-mono)",whiteSpace:"nowrap"},children:r})}function p({label:r,height:n}){return e.jsx("div",{style:{padding:"6px 12px",height:n,background:"var(--color-slab)",borderRadius:"var(--radius-sm)",fontSize:"var(--font-size-sm)",color:"var(--color-text-secondary)",display:"flex",alignItems:"flex-end"},children:r})}const s={render:()=>e.jsxs(o,{children:[e.jsx(a,{label:"first"}),e.jsx(a,{label:"second"}),e.jsx(a,{label:"third"})]})},t={name:"Gap Scale",render:()=>{const r=["1","2","3","4","5","6","8"];return e.jsx("div",{style:{display:"flex",flexDirection:"column",gap:24},children:r.map(n=>e.jsxs("div",{children:[e.jsxs("p",{style:{fontSize:"var(--font-size-xs)",color:"var(--color-text-muted)",fontFamily:"var(--font-mono)",marginBottom:8},children:['gap="',n,'"']}),e.jsxs(o,{gap:n,children:[e.jsx(a,{label:"alpha"}),e.jsx(a,{label:"beta"}),e.jsx(a,{label:"gamma"})]})]},n))})}},i={name:"Alignment Variants",render:()=>{const r=["start","center","end","baseline"];return e.jsx("div",{style:{display:"flex",flexDirection:"column",gap:24},children:r.map(n=>e.jsxs("div",{children:[e.jsxs("p",{style:{fontSize:"var(--font-size-xs)",color:"var(--color-text-muted)",fontFamily:"var(--font-mono)",marginBottom:8},children:['align="',n,'"']}),e.jsxs(o,{align:n,style:{background:"var(--color-slab-elevated)",border:"1px solid var(--color-border)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",height:64},children:[e.jsx(p,{label:"short",height:28}),e.jsx(p,{label:"tall",height:48}),e.jsx(p,{label:"mid",height:36})]})]},n))})}},l={name:"Justification Variants",render:()=>{const r=["start","between","end"];return e.jsx("div",{style:{display:"flex",flexDirection:"column",gap:24},children:r.map(n=>e.jsxs("div",{children:[e.jsxs("p",{style:{fontSize:"var(--font-size-xs)",color:"var(--color-text-muted)",fontFamily:"var(--font-mono)",marginBottom:8},children:['justify="',n,'"']}),e.jsxs(o,{justify:n,style:{background:"var(--color-slab-elevated)",border:"1px solid var(--color-border)",borderRadius:"var(--radius-md)",padding:"var(--space-3)"},children:[e.jsx(a,{label:"alpha"}),e.jsx(a,{label:"beta"}),e.jsx(a,{label:"gamma"})]})]},n))})}},c={name:"Wrap",render:()=>e.jsx("div",{style:{maxWidth:360},children:e.jsx(o,{wrap:!0,gap:"2",children:["research","summarisation","drafting","analysis","fact-check","translation"].map(r=>e.jsx(a,{label:r},r))})})},d={name:"Real Use Case — Card Header",render:()=>e.jsx("div",{style:{width:420,padding:"var(--space-4) var(--space-5)",background:"var(--color-card)",border:"1px solid var(--color-border)",borderRadius:"var(--radius-lg)"},children:e.jsxs(o,{justify:"between",align:"center",children:[e.jsx("span",{style:{fontSize:"var(--font-size-base)",fontWeight:"var(--font-weight-semibold)",color:"var(--color-text-title)"},children:"Research Lead"}),e.jsxs(o,{gap:"2",align:"center",children:[e.jsx("span",{style:{padding:"3px 8px",fontSize:"var(--font-size-xs)",fontWeight:"var(--font-weight-medium)",color:"var(--color-success)",background:"var(--color-success-bg)",border:"1px solid var(--color-success-border)",borderRadius:"var(--radius-full)"},children:"active"}),e.jsx("div",{style:{width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"var(--radius-md)",background:"var(--color-slab)",color:"var(--color-text-secondary)",cursor:"pointer"},children:e.jsxs("svg",{width:"14",height:"14",viewBox:"0 0 14 14",fill:"none",children:[e.jsx("circle",{cx:"3",cy:"7",r:"1.2",fill:"currentColor"}),e.jsx("circle",{cx:"7",cy:"7",r:"1.2",fill:"currentColor"}),e.jsx("circle",{cx:"11",cy:"7",r:"1.2",fill:"currentColor"})]})})]})]})})};var m,u,v;s.parameters={...s.parameters,docs:{...(m=s.parameters)==null?void 0:m.docs,source:{originalSource:`{
  render: () => <Inline>
      <Chip label="first" />
      <Chip label="second" />
      <Chip label="third" />
    </Inline>
}`,...(v=(u=s.parameters)==null?void 0:u.docs)==null?void 0:v.source}}};var g,x,f;t.parameters={...t.parameters,docs:{...(g=t.parameters)==null?void 0:g.docs,source:{originalSource:`{
  name: "Gap Scale",
  render: () => {
    const gaps: SpaceToken[] = ["1", "2", "3", "4", "5", "6", "8"];
    return <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 24
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
            <Inline gap={gap}>
              <Chip label="alpha" />
              <Chip label="beta" />
              <Chip label="gamma" />
            </Inline>
          </div>)}
      </div>;
  }
}`,...(f=(x=t.parameters)==null?void 0:x.docs)==null?void 0:f.source}}};var h,b,y;i.parameters={...i.parameters,docs:{...(h=i.parameters)==null?void 0:h.docs,source:{originalSource:`{
  name: "Alignment Variants",
  render: () => {
    const aligns = ["start", "center", "end", "baseline"] as const;
    return <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 24
    }}>
        {aligns.map(align => <div key={align}>
            <p style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-mono)",
          marginBottom: 8
        }}>
              align=&quot;{align}&quot;
            </p>
            <Inline align={align} style={{
          background: "var(--color-slab-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3)",
          height: 64
        }}>
              <TallChip label="short" height={28} />
              <TallChip label="tall" height={48} />
              <TallChip label="mid" height={36} />
            </Inline>
          </div>)}
      </div>;
  }
}`,...(y=(b=i.parameters)==null?void 0:b.docs)==null?void 0:y.source}}};var j,C,z;l.parameters={...l.parameters,docs:{...(j=l.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: "Justification Variants",
  render: () => {
    const justifies = ["start", "between", "end"] as const;
    return <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 24
    }}>
        {justifies.map(justify => <div key={justify}>
            <p style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-mono)",
          marginBottom: 8
        }}>
              justify=&quot;{justify}&quot;
            </p>
            <Inline justify={justify} style={{
          background: "var(--color-slab-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3)"
        }}>
              <Chip label="alpha" />
              <Chip label="beta" />
              <Chip label="gamma" />
            </Inline>
          </div>)}
      </div>;
  }
}`,...(z=(C=l.parameters)==null?void 0:C.docs)==null?void 0:z.source}}};var S,w,I;c.parameters={...c.parameters,docs:{...(S=c.parameters)==null?void 0:S.docs,source:{originalSource:`{
  name: "Wrap",
  render: () => <div style={{
    maxWidth: 360
  }}>
      <Inline wrap gap="2">
        {["research", "summarisation", "drafting", "analysis", "fact-check", "translation"].map(tag => <Chip key={tag} label={tag} />)}
      </Inline>
    </div>
}`,...(I=(w=c.parameters)==null?void 0:w.docs)==null?void 0:I.source}}};var R,k,W;d.parameters={...d.parameters,docs:{...(R=d.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: "Real Use Case — Card Header",
  render: () => <div style={{
    width: 420,
    padding: "var(--space-4) var(--space-5)",
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)"
  }}>
      <Inline justify="between" align="center">
        {/* Left: agent name */}
        <span style={{
        fontSize: "var(--font-size-base)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--color-text-title)"
      }}>
          Research Lead
        </span>

        {/* Right: badge + icon action */}
        <Inline gap="2" align="center">
          <span style={{
          padding: "3px 8px",
          fontSize: "var(--font-size-xs)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--color-success)",
          background: "var(--color-success-bg)",
          border: "1px solid var(--color-success-border)",
          borderRadius: "var(--radius-full)"
        }}>
            active
          </span>
          <div style={{
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-md)",
          background: "var(--color-slab)",
          color: "var(--color-text-secondary)",
          cursor: "pointer"
        }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="3" cy="7" r="1.2" fill="currentColor" />
              <circle cx="7" cy="7" r="1.2" fill="currentColor" />
              <circle cx="11" cy="7" r="1.2" fill="currentColor" />
            </svg>
          </div>
        </Inline>
      </Inline>
    </div>
}`,...(W=(k=d.parameters)==null?void 0:k.docs)==null?void 0:W.source}}};const A=["Default","GapScale","Alignment","Justification","Wrap","RealUseCase"];export{i as Alignment,s as Default,t as GapScale,l as Justification,d as RealUseCase,c as Wrap,A as __namedExportsOrder,T as default};
