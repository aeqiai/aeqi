import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as x}from"./index-oxIuDU2I.js";import{B as b}from"./Button-DVRBRNVW.js";import"./_commonjsHelpers-CqkleIqs.js";const V="_wrapper_560ex_5",$="_label_560ex_11",F="_textarea_560ex_17",M="_hasError_560ex_34",U="_hint_560ex_62",G="_error_560ex_67",r={wrapper:V,label:$,textarea:F,hasError:M,hint:U,error:G},a=x.forwardRef(function({label:u,hint:h,error:t,className:O,id:z,...K},H){const L=x.useId(),s=z||L,m=h?`${s}-hint`:void 0,g=t?`${s}-error`:void 0,P=[m,g].filter(Boolean).join(" ")||void 0;return e.jsxs("div",{className:r.wrapper,children:[u&&e.jsx("label",{className:r.label,htmlFor:s,children:u}),e.jsx("textarea",{ref:H,id:s,className:[r.textarea,t?r.hasError:"",O].filter(Boolean).join(" "),"aria-invalid":t?!0:void 0,"aria-describedby":P,...K}),h&&!t&&e.jsx("span",{id:m,className:r.hint,children:h}),t&&e.jsx("span",{id:g,className:r.error,role:"alert",children:t})]})});a.displayName="Textarea";a.__docgenInfo={description:"",methods:[],displayName:"Textarea",props:{label:{required:!1,tsType:{name:"string"},description:""},hint:{required:!1,tsType:{name:"string"},description:""},error:{required:!1,tsType:{name:"string"},description:""}}};const re={title:"Components/Textarea",component:a,tags:["autodocs"],parameters:{docs:{description:{component:"Multi-line text input with the same label/hint/error pattern as `Input`. Use for free-form prose: identity ideas, acceptance criteria, and message composition."}}}},n={args:{placeholder:"Describe what the agent should do...",rows:4}},o={args:{label:"Identity",placeholder:"You are an agent that...",rows:4}},i={args:{label:"Acceptance criteria",placeholder:"Define what done looks like...",hint:"Be specific — agents use this to decide when a quest is complete.",rows:3}},l={args:{label:"Quest description",value:"fix it",error:"Quest description must be at least 20 characters.",rows:3}},d={args:{label:"Identity (inherited)",value:"You are part of the orchestrator tree. Delegate aggressively.",disabled:!0,rows:3}},c={name:"Quest Composer",render:()=>e.jsxs("div",{style:{maxWidth:480,padding:24,border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[e.jsx("h3",{style:{fontSize:16,fontWeight:600,color:"rgba(0,0,0,0.85)",margin:"0 0 4px"},children:"New quest"}),e.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.4)",margin:"0 0 20px"},children:"Describe the work. An agent will pick it up."}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:14},children:[e.jsx(a,{label:"Objective",placeholder:"Refactor the payments module to use the new SDK...",rows:3}),e.jsx(a,{label:"Acceptance criteria",placeholder:"Done when tests pass, old SDK uninstalled, and PR merged.",hint:"The agent uses this to decide when the quest is complete.",rows:3})]}),e.jsxs("div",{style:{marginTop:20,display:"flex",gap:8,justifyContent:"flex-end",borderTop:"1px solid rgba(0,0,0,0.08)",paddingTop:16},children:[e.jsx(b,{variant:"ghost",children:"Cancel"}),e.jsx(b,{variant:"primary",children:"Create quest"})]})]})},p={name:"Identity Editor",render:()=>e.jsx("div",{style:{maxWidth:520},children:e.jsx(a,{label:"Agent identity",defaultValue:`You are the CTO agent in the aeqi tree. You set technical direction, review
architectural proposals from subordinate agents, and delegate implementation
to the appropriate specialist. You do not write code yourself — you orchestrate.`,rows:8,hint:"Assembled into the agent's identity on every turn."})})};var y,f,w;n.parameters={...n.parameters,docs:{...(y=n.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    placeholder: "Describe what the agent should do...",
    rows: 4
  }
}`,...(w=(f=n.parameters)==null?void 0:f.docs)==null?void 0:w.source}}};var v,j,_;o.parameters={...o.parameters,docs:{...(v=o.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    label: "Identity",
    placeholder: "You are an agent that...",
    rows: 4
  }
}`,...(_=(j=o.parameters)==null?void 0:j.docs)==null?void 0:_.source}}};var T,D,I;i.parameters={...i.parameters,docs:{...(T=i.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    label: "Acceptance criteria",
    placeholder: "Define what done looks like...",
    hint: "Be specific — agents use this to decide when a quest is complete.",
    rows: 3
  }
}`,...(I=(D=i.parameters)==null?void 0:D.docs)==null?void 0:I.source}}};var S,q,C;l.parameters={...l.parameters,docs:{...(S=l.parameters)==null?void 0:S.docs,source:{originalSource:`{
  args: {
    label: "Quest description",
    value: "fix it",
    error: "Quest description must be at least 20 characters.",
    rows: 3
  }
}`,...(C=(q=l.parameters)==null?void 0:q.docs)==null?void 0:C.source}}};var E,W,B;d.parameters={...d.parameters,docs:{...(E=d.parameters)==null?void 0:E.docs,source:{originalSource:`{
  args: {
    label: "Identity (inherited)",
    value: "You are part of the orchestrator tree. Delegate aggressively.",
    disabled: true,
    rows: 3
  }
}`,...(B=(W=d.parameters)==null?void 0:W.docs)==null?void 0:B.source}}};var A,Y,N;c.parameters={...c.parameters,docs:{...(A=c.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: "Quest Composer",
  render: () => <div style={{
    maxWidth: 480,
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
        New quest
      </h3>
      <p style={{
      fontSize: 13,
      color: "rgba(0,0,0,0.4)",
      margin: "0 0 20px"
    }}>
        Describe the work. An agent will pick it up.
      </p>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 14
    }}>
        <Textarea label="Objective" placeholder="Refactor the payments module to use the new SDK..." rows={3} />
        <Textarea label="Acceptance criteria" placeholder="Done when tests pass, old SDK uninstalled, and PR merged." hint="The agent uses this to decide when the quest is complete." rows={3} />
      </div>
      <div style={{
      marginTop: 20,
      display: "flex",
      gap: 8,
      justifyContent: "flex-end",
      borderTop: "1px solid rgba(0,0,0,0.08)",
      paddingTop: 16
    }}>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Create quest</Button>
      </div>
    </div>
}`,...(N=(Y=c.parameters)==null?void 0:Y.docs)==null?void 0:N.source}}};var k,Q,R;p.parameters={...p.parameters,docs:{...(k=p.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: "Identity Editor",
  render: () => <div style={{
    maxWidth: 520
  }}>
      <Textarea label="Agent identity" defaultValue={\`You are the CTO agent in the aeqi tree. You set technical direction, review
architectural proposals from subordinate agents, and delegate implementation
to the appropriate specialist. You do not write code yourself — you orchestrate.\`} rows={8} hint="Assembled into the agent's identity on every turn." />
    </div>
}`,...(R=(Q=p.parameters)==null?void 0:Q.docs)==null?void 0:R.source}}};const ae=["Default","WithLabel","WithHint","WithError","Disabled","QuestComposer","IdentityEditor"];export{n as Default,d as Disabled,p as IdentityEditor,c as QuestComposer,l as WithError,i as WithHint,o as WithLabel,ae as __namedExportsOrder,re as default};
