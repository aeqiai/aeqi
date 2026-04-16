var b=Object.defineProperty;var E=(n,o,e)=>o in n?b(n,o,{enumerable:!0,configurable:!0,writable:!0,value:e}):n[o]=e;var d=(n,o,e)=>E(n,typeof o!="symbol"?o+"":o,e);import{j as r}from"./jsx-runtime-D_zvdyIk.js";import{r as v}from"./index-JhL3uwfD.js";class t extends v.Component{constructor(){super(...arguments);d(this,"state",{hasError:!1,error:null})}static getDerivedStateFromError(e){return{hasError:!0,error:e}}render(){var e;return this.state.hasError?this.props.fallback||r.jsxs("div",{style:{padding:"2rem",textAlign:"center"},children:[r.jsx("h2",{children:"Something went wrong"}),r.jsx("pre",{style:{fontSize:"0.85rem",color:"var(--color-error)",marginTop:"1rem"},children:(e=this.state.error)==null?void 0:e.message}),r.jsx("button",{onClick:()=>this.setState({hasError:!1,error:null}),style:{marginTop:"1rem"},children:"Try again"})]}):this.props.children}}Object.defineProperty(t,"displayName",{value:"ErrorBoundary"});t.__docgenInfo={description:"",methods:[],displayName:"ErrorBoundary",props:{children:{required:!0,tsType:{name:"ReactNode"},description:""},fallback:{required:!1,tsType:{name:"ReactNode"},description:""}}};const T={title:"UI/ErrorBoundary",component:t,tags:["autodocs"]};function f(){throw new Error("Something went wrong in this component")}const s={render:()=>r.jsx(t,{children:r.jsx(f,{})})},a={render:()=>r.jsx(t,{fallback:r.jsxs("div",{style:{padding:24,textAlign:"center",background:"var(--color-error-bg)",borderRadius:8,color:"var(--color-error)"},children:[r.jsx("p",{style:{fontWeight:600},children:"Custom error fallback"}),r.jsx("p",{style:{fontSize:13,marginTop:8},children:"Something broke. Please try refreshing."})]}),children:r.jsx(f,{})})},i={render:()=>r.jsx(t,{children:r.jsx("div",{style:{padding:24,border:"1px solid var(--color-border)",borderRadius:8,textAlign:"center"},children:r.jsx("p",{style:{fontSize:13,color:"var(--color-text-secondary)"},children:"This component rendered successfully."})})})};var c,l,p;s.parameters={...s.parameters,docs:{...(c=s.parameters)==null?void 0:c.docs,source:{originalSource:`{
  render: () => <ErrorBoundary>
      <ThrowingComponent />
    </ErrorBoundary>
}`,...(p=(l=s.parameters)==null?void 0:l.docs)==null?void 0:p.source}}};var m,u,h;a.parameters={...a.parameters,docs:{...(m=a.parameters)==null?void 0:m.docs,source:{originalSource:`{
  render: () => <ErrorBoundary fallback={<div style={{
    padding: 24,
    textAlign: "center",
    background: "var(--color-error-bg)",
    borderRadius: 8,
    color: "var(--color-error)"
  }}>
          <p style={{
      fontWeight: 600
    }}>Custom error fallback</p>
          <p style={{
      fontSize: 13,
      marginTop: 8
    }}>Something broke. Please try refreshing.</p>
        </div>}>
      <ThrowingComponent />
    </ErrorBoundary>
}`,...(h=(u=a.parameters)==null?void 0:u.docs)==null?void 0:h.source}}};var g,y,x;i.parameters={...i.parameters,docs:{...(g=i.parameters)==null?void 0:g.docs,source:{originalSource:`{
  render: () => <ErrorBoundary>
      <div style={{
      padding: 24,
      border: "1px solid var(--color-border)",
      borderRadius: 8,
      textAlign: "center"
    }}>
        <p style={{
        fontSize: 13,
        color: "var(--color-text-secondary)"
      }}>
          This component rendered successfully.
        </p>
      </div>
    </ErrorBoundary>
}`,...(x=(y=i.parameters)==null?void 0:y.docs)==null?void 0:x.source}}};const B=["WithError","WithCustomFallback","WithoutError"];export{a as WithCustomFallback,s as WithError,i as WithoutError,B as __namedExportsOrder,T as default};
