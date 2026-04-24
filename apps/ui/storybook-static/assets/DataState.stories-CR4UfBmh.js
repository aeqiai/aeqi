import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{S as I}from"./Spinner-BocUsjO0.js";import{E as A}from"./EmptyState-DfvOl-Bg.js";import{S as P}from"./Badge-CRC_81sh.js";const B="_loading_1k561_1",W="_loadingText_1k561_12",m={loading:B,loadingText:W};function n({loading:t,empty:p,emptyTitle:_="Nothing here",emptyDescription:w="",loadingText:c,children:F}){return t?e.jsxs("div",{className:m.loading,role:"status",children:[e.jsx(I,{size:"md"}),c&&e.jsx("span",{className:m.loadingText,children:c})]}):p?e.jsx(A,{title:_,description:w}):e.jsx(e.Fragment,{children:F})}n.displayName="DataState";n.__docgenInfo={description:"",methods:[],displayName:"DataState",props:{loading:{required:!0,tsType:{name:"boolean"},description:""},empty:{required:!0,tsType:{name:"boolean"},description:""},emptyTitle:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'"Nothing here"',computed:!1}},emptyDescription:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'""',computed:!1}},loadingText:{required:!1,tsType:{name:"string"},description:""},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};const H={title:"Primitives/Feedback/DataState",component:n,tags:["autodocs"]},a={args:{loading:!0,empty:!1,children:e.jsx("div",{children:"Content"})}},s={name:"Loading Quests",render:()=>e.jsx(n,{loading:!0,empty:!1,loadingText:"Fetching quests...",children:e.jsx("div",{children:"Content"})})},r={name:"Loading Agents",render:()=>e.jsx(n,{loading:!0,empty:!1,loadingText:"Connecting to agents...",children:e.jsx("div",{children:"Content"})})},i={name:"Empty Quest List",args:{loading:!1,empty:!0,emptyTitle:"No quests found",emptyDescription:"Create a quest to assign work to your agents.",children:e.jsx("div",{children:"Content"})}},o={name:"Empty Event Stream",args:{loading:!1,empty:!0,emptyTitle:"No events recorded",emptyDescription:"Events will appear here once your agents start running.",children:e.jsx("div",{children:"Content"})}},d={name:"Loaded Quest List",args:{loading:!1,empty:!1,children:e.jsx("div",{style:{display:"flex",flexDirection:"column"},children:[{name:"Refactor auth module",status:"in_progress"},{name:"Write migration script",status:"pending"},{name:"Deploy v0.5.0",status:"blocked"},{name:"Update API docs",status:"done"}].map((t,p)=>e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderTop:p>0?"1px solid rgba(0,0,0,0.06)":void 0},children:[e.jsx("span",{style:{fontSize:13,color:"rgba(0,0,0,0.85)"},children:t.name}),e.jsx(P,{status:t.status,size:"sm"})]},t.name))})}},l={name:"State Lifecycle",render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:32,maxWidth:400},children:[e.jsxs("div",{children:[e.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:"0 0 8px",textTransform:"uppercase",letterSpacing:"0.05em"},children:"1. Loading"}),e.jsx("div",{style:{border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,padding:16},children:e.jsx(n,{loading:!0,empty:!1,loadingText:"Fetching ideas...",children:e.jsx("div",{})})})]}),e.jsxs("div",{children:[e.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:"0 0 8px",textTransform:"uppercase",letterSpacing:"0.05em"},children:"2. Empty"}),e.jsx("div",{style:{border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,padding:16},children:e.jsx(n,{loading:!1,empty:!0,emptyTitle:"No ideas yet",emptyDescription:"Store knowledge for your agents.",children:e.jsx("div",{})})})]}),e.jsxs("div",{children:[e.jsx("p",{style:{fontSize:12,color:"rgba(0,0,0,0.4)",margin:"0 0 8px",textTransform:"uppercase",letterSpacing:"0.05em"},children:"3. Content"}),e.jsx("div",{style:{border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,padding:16},children:e.jsx(n,{loading:!1,empty:!1,children:e.jsxs("div",{style:{fontSize:13,color:"rgba(0,0,0,0.85)"},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:8},children:[e.jsx("strong",{children:"deployment-checklist"}),e.jsx("span",{style:{fontSize:11,color:"rgba(0,0,0,0.35)"},children:"idea"})]}),e.jsx("p",{style:{color:"rgba(0,0,0,0.55)",margin:0},children:"Pre-deployment verification steps for the production environment."})]})})})]})]})};var g,u,y;a.parameters={...a.parameters,docs:{...(g=a.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    loading: true,
    empty: false,
    children: <div>Content</div>
  }
}`,...(y=(u=a.parameters)==null?void 0:u.docs)==null?void 0:y.source}}};var x,f,v;s.parameters={...s.parameters,docs:{...(x=s.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: "Loading Quests",
  render: () => <DataState loading={true} empty={false} loadingText="Fetching quests...">
      <div>Content</div>
    </DataState>
}`,...(v=(f=s.parameters)==null?void 0:f.docs)==null?void 0:v.source}}};var h,S,b;r.parameters={...r.parameters,docs:{...(h=r.parameters)==null?void 0:h.docs,source:{originalSource:`{
  name: "Loading Agents",
  render: () => <DataState loading={true} empty={false} loadingText="Connecting to agents...">
      <div>Content</div>
    </DataState>
}`,...(b=(S=r.parameters)==null?void 0:S.docs)==null?void 0:b.source}}};var j,T,D;i.parameters={...i.parameters,docs:{...(j=i.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: "Empty Quest List",
  args: {
    loading: false,
    empty: true,
    emptyTitle: "No quests found",
    emptyDescription: "Create a quest to assign work to your agents.",
    children: <div>Content</div>
  }
}`,...(D=(T=i.parameters)==null?void 0:T.docs)==null?void 0:D.source}}};var L,E,C;o.parameters={...o.parameters,docs:{...(L=o.parameters)==null?void 0:L.docs,source:{originalSource:`{
  name: "Empty Event Stream",
  args: {
    loading: false,
    empty: true,
    emptyTitle: "No events recorded",
    emptyDescription: "Events will appear here once your agents start running.",
    children: <div>Content</div>
  }
}`,...(C=(E=o.parameters)==null?void 0:E.docs)==null?void 0:C.source}}};var z,q,N;d.parameters={...d.parameters,docs:{...(z=d.parameters)==null?void 0:z.docs,source:{originalSource:`{
  name: "Loaded Quest List",
  args: {
    loading: false,
    empty: false,
    children: <div style={{
      display: "flex",
      flexDirection: "column"
    }}>
        {[{
        name: "Refactor auth module",
        status: "in_progress"
      }, {
        name: "Write migration script",
        status: "pending"
      }, {
        name: "Deploy v0.5.0",
        status: "blocked"
      }, {
        name: "Update API docs",
        status: "done"
      }].map((q, i) => <div key={q.name} style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderTop: i > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined
      }}>
            <span style={{
          fontSize: 13,
          color: "rgba(0,0,0,0.85)"
        }}>{q.name}</span>
            <StatusBadge status={q.status} size="sm" />
          </div>)}
      </div>
  }
}`,...(N=(q=d.parameters)==null?void 0:q.docs)==null?void 0:N.source}}};var R,k,Q;l.parameters={...l.parameters,docs:{...(R=l.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: "State Lifecycle",
  render: () => <div style={{
    display: "flex",
    flexDirection: "column",
    gap: 32,
    maxWidth: 400
  }}>
      <div>
        <p style={{
        fontSize: 12,
        color: "rgba(0,0,0,0.4)",
        margin: "0 0 8px",
        textTransform: "uppercase",
        letterSpacing: "0.05em"
      }}>
          1. Loading
        </p>
        <div style={{
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
        padding: 16
      }}>
          <DataState loading={true} empty={false} loadingText="Fetching ideas...">
            <div />
          </DataState>
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
          2. Empty
        </p>
        <div style={{
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
        padding: 16
      }}>
          <DataState loading={false} empty={true} emptyTitle="No ideas yet" emptyDescription="Store knowledge for your agents.">
            <div />
          </DataState>
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
          3. Content
        </p>
        <div style={{
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
        padding: 16
      }}>
          <DataState loading={false} empty={false}>
            <div style={{
            fontSize: 13,
            color: "rgba(0,0,0,0.85)"
          }}>
              <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8
            }}>
                <strong>deployment-checklist</strong>
                <span style={{
                fontSize: 11,
                color: "rgba(0,0,0,0.35)"
              }}>idea</span>
              </div>
              <p style={{
              color: "rgba(0,0,0,0.55)",
              margin: 0
            }}>
                Pre-deployment verification steps for the production environment.
              </p>
            </div>
          </DataState>
        </div>
      </div>
    </div>
}`,...(Q=(k=l.parameters)==null?void 0:k.docs)==null?void 0:Q.source}}};const J=["Loading","LoadingQuests","LoadingAgents","EmptyQuests","EmptyEvents","QuestList","FullLifecycle"];export{o as EmptyEvents,i as EmptyQuests,l as FullLifecycle,a as Loading,r as LoadingAgents,s as LoadingQuests,d as QuestList,J as __namedExportsOrder,H as default};
