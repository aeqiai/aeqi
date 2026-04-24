var E=Object.defineProperty;var j=(o,n,e)=>n in o?E(o,n,{enumerable:!0,configurable:!0,writable:!0,value:e}):o[n]=e;var c=(o,n,e)=>j(o,typeof n!="symbol"?n+"":n,e);import{j as r}from"./jsx-runtime-D_zvdyIk.js";import{r as S}from"./index-oxIuDU2I.js";import{B as k}from"./Button-DVRBRNVW.js";import"./_commonjsHelpers-CqkleIqs.js";const _="_wrapper_llruu_1",w="_title_llruu_6",F="_message_llruu_13",B="_retry_llruu_20",t={wrapper:_,title:w,message:F,retry:B};class a extends S.Component{constructor(){super(...arguments);c(this,"state",{hasError:!1,error:null})}static getDerivedStateFromError(e){return{hasError:!0,error:e}}render(){var e;return this.state.hasError?this.props.fallback||r.jsxs("div",{className:t.wrapper,children:[r.jsx("h2",{className:t.title,children:"Something went wrong"}),r.jsx("pre",{className:t.message,children:(e=this.state.error)==null?void 0:e.message}),r.jsx(k,{variant:"secondary",className:t.retry,onClick:()=>this.setState({hasError:!1,error:null}),children:"Try again"})]}):this.props.children}}Object.defineProperty(a,"displayName",{value:"ErrorBoundary"});a.__docgenInfo={description:"",methods:[],displayName:"ErrorBoundary",props:{children:{required:!0,tsType:{name:"ReactNode"},description:""},fallback:{required:!1,tsType:{name:"ReactNode"},description:""}}};const z={title:"Primitives/Feedback/ErrorBoundary",component:a,tags:["autodocs"]};function x(){throw new Error("Agent runtime connection failed: ECONNREFUSED 127.0.0.1:8400")}const s={name:"Default Error Fallback",render:()=>r.jsx(a,{children:r.jsx(x,{})})},i={name:"Custom Error Fallback",render:()=>r.jsx(a,{fallback:r.jsxs("div",{style:{padding:32,textAlign:"center",border:"1px solid rgba(0,0,0,0.08)",borderRadius:8},children:[r.jsx("p",{style:{fontWeight:600,fontSize:14,color:"rgba(0,0,0,0.85)",margin:"0 0 8px"},children:"Failed to load agent panel"}),r.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.4)",margin:0},children:"The agent runtime may be offline. Check your daemon connection in Settings."})]}),children:r.jsx(x,{})})},l={name:"Successful Render",render:()=>r.jsx(a,{children:r.jsx("div",{style:{padding:24,border:"1px solid rgba(0,0,0,0.08)",borderRadius:8,textAlign:"center"},children:r.jsx("p",{style:{fontSize:13,color:"rgba(0,0,0,0.55)",margin:0},children:"This component rendered successfully. The error boundary is transparent when no error occurs."})})})};var d,p,u;s.parameters={...s.parameters,docs:{...(d=s.parameters)==null?void 0:d.docs,source:{originalSource:`{
  name: "Default Error Fallback",
  render: () => <ErrorBoundary>
      <ThrowingComponent />
    </ErrorBoundary>
}`,...(u=(p=s.parameters)==null?void 0:p.docs)==null?void 0:u.source}}};var m,g,h;i.parameters={...i.parameters,docs:{...(m=i.parameters)==null?void 0:m.docs,source:{originalSource:`{
  name: "Custom Error Fallback",
  render: () => <ErrorBoundary fallback={<div style={{
    padding: 32,
    textAlign: "center",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 8
  }}>
          <p style={{
      fontWeight: 600,
      fontSize: 14,
      color: "rgba(0,0,0,0.85)",
      margin: "0 0 8px"
    }}>
            Failed to load agent panel
          </p>
          <p style={{
      fontSize: 13,
      color: "rgba(0,0,0,0.4)",
      margin: 0
    }}>
            The agent runtime may be offline. Check your daemon connection in Settings.
          </p>
        </div>}>
      <ThrowingComponent />
    </ErrorBoundary>
}`,...(h=(g=i.parameters)==null?void 0:g.docs)==null?void 0:h.source}}};var y,b,f;l.parameters={...l.parameters,docs:{...(y=l.parameters)==null?void 0:y.docs,source:{originalSource:`{
  name: "Successful Render",
  render: () => <ErrorBoundary>
      <div style={{
      padding: 24,
      border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 8,
      textAlign: "center"
    }}>
        <p style={{
        fontSize: 13,
        color: "rgba(0,0,0,0.55)",
        margin: 0
      }}>
          This component rendered successfully. The error boundary is transparent when no error
          occurs.
        </p>
      </div>
    </ErrorBoundary>
}`,...(f=(b=l.parameters)==null?void 0:b.docs)==null?void 0:f.source}}};const D=["DefaultFallback","CustomFallback","NoError"];export{i as CustomFallback,s as DefaultFallback,l as NoError,D as __namedExportsOrder,z as default};
