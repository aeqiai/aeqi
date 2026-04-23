import{j as e}from"./jsx-runtime-D_zvdyIk.js";const P="_wrapper_1qh2d_1",S="_track_1qh2d_7",q="_fill_1qh2d_14",N="_label_1qh2d_21",r={wrapper:P,track:S,fill:q,label:N};function c({value:a,max:i=100,label:m}){const C=i>0?Math.min(100,a/i*100):0;return e.jsxs("div",{className:r.wrapper,children:[e.jsx("div",{className:r.track,role:"progressbar","aria-valuenow":a,"aria-valuemin":0,"aria-valuemax":i,"aria-label":m,children:e.jsx("div",{className:r.fill,style:{width:`${C}%`}})}),m&&e.jsx("span",{className:r.label,children:m})]})}c.displayName="ProgressBar";c.__docgenInfo={description:"",methods:[],displayName:"ProgressBar",props:{value:{required:!0,tsType:{name:"number"},description:""},max:{required:!1,tsType:{name:"number"},description:"",defaultValue:{value:"100",computed:!1}},label:{required:!1,tsType:{name:"string"},description:""}}};const I={title:"Components/ProgressBar",component:c,tags:["autodocs"],decorators:[a=>e.jsx("div",{style:{width:320},children:e.jsx(a,{})})]},s={args:{value:0,label:"0%"}},t={name:"In Progress",args:{value:42,label:"42%"}},n={args:{value:100,label:"100%"}},o={name:"Quest Task Completion",args:{value:7,max:10,label:"7 of 10 tasks complete"}},l={name:"Agent Workload",render:()=>e.jsx("div",{style:{display:"flex",flexDirection:"column",gap:16,maxWidth:360},children:[{agent:"code-reviewer",current:8,max:10},{agent:"deploy-agent",current:2,max:10},{agent:"test-runner",current:6,max:10},{agent:"docs-writer",current:0,max:10}].map(a=>e.jsxs("div",{children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:6},children:[e.jsx("code",{style:{fontFamily:"var(--font-mono, 'JetBrains Mono', monospace)",fontSize:12,color:"rgba(0,0,0,0.7)"},children:a.agent}),e.jsxs("span",{style:{fontSize:12,color:"rgba(0,0,0,0.4)"},children:[a.current,"/",a.max]})]}),e.jsx(c,{value:a.current,max:a.max})]},a.agent))})};var d,p,u;s.parameters={...s.parameters,docs:{...(d=s.parameters)==null?void 0:d.docs,source:{originalSource:`{
  args: {
    value: 0,
    label: "0%"
  }
}`,...(u=(p=s.parameters)==null?void 0:p.docs)==null?void 0:u.source}}};var g,x,v;t.parameters={...t.parameters,docs:{...(g=t.parameters)==null?void 0:g.docs,source:{originalSource:`{
  name: "In Progress",
  args: {
    value: 42,
    label: "42%"
  }
}`,...(v=(x=t.parameters)==null?void 0:x.docs)==null?void 0:v.source}}};var f,y,b;n.parameters={...n.parameters,docs:{...(f=n.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    value: 100,
    label: "100%"
  }
}`,...(b=(y=n.parameters)==null?void 0:y.docs)==null?void 0:b.source}}};var h,j,_;o.parameters={...o.parameters,docs:{...(h=o.parameters)==null?void 0:h.docs,source:{originalSource:`{
  name: "Quest Task Completion",
  args: {
    value: 7,
    max: 10,
    label: "7 of 10 tasks complete"
  }
}`,...(_=(j=o.parameters)==null?void 0:j.docs)==null?void 0:_.source}}};var k,w,B;l.parameters={...l.parameters,docs:{...(k=l.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: "Agent Workload",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 360
  }}>
      {[{
      agent: "code-reviewer",
      current: 8,
      max: 10
    }, {
      agent: "deploy-agent",
      current: 2,
      max: 10
    }, {
      agent: "test-runner",
      current: 6,
      max: 10
    }, {
      agent: "docs-writer",
      current: 0,
      max: 10
    }].map(a => <div key={a.agent}>
          <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 6
      }}>
            <code style={{
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: 12,
          color: "rgba(0,0,0,0.7)"
        }}>
              {a.agent}
            </code>
            <span style={{
          fontSize: 12,
          color: "rgba(0,0,0,0.4)"
        }}>
              {a.current}/{a.max}
            </span>
          </div>
          <ProgressBar value={a.current} max={a.max} />
        </div>)}
    </div>
}`,...(B=(w=l.parameters)==null?void 0:w.docs)==null?void 0:B.source}}};const T=["Empty","InProgress","Complete","QuestCompletion","AgentWorkload"];export{l as AgentWorkload,n as Complete,s as Empty,t as InProgress,o as QuestCompletion,T as __namedExportsOrder,I as default};
