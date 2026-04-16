import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{E as q}from"./EmptyState-D9CjHNDe.js";function o({loading:x,empty:v,emptyTitle:T="Nothing here",emptyDescription:C="",loadingText:S="Loading...",children:j}){return x?e.jsx("div",{className:"loading",children:S}):v?e.jsx(q,{title:T,description:C}):e.jsx(e.Fragment,{children:j})}o.displayName="DataState";o.__docgenInfo={description:"",methods:[],displayName:"DataState",props:{loading:{required:!0,tsType:{name:"boolean"},description:""},empty:{required:!0,tsType:{name:"boolean"},description:""},emptyTitle:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'"Nothing here"',computed:!1}},emptyDescription:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'""',computed:!1}},loadingText:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'"Loading..."',computed:!1}},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};const D={title:"UI/DataState",component:o,tags:["autodocs"]},t={args:{loading:!0,empty:!1,children:e.jsx("div",{children:"Content"})}},n={args:{loading:!0,empty:!1,loadingText:"Fetching agents...",children:e.jsx("div",{children:"Content"})}},a={args:{loading:!1,empty:!0,emptyTitle:"No quests found",emptyDescription:"Create a quest to get started.",children:e.jsx("div",{children:"Content"})}},r={args:{loading:!1,empty:!1,children:e.jsx("div",{style:{padding:16,border:"1px solid var(--color-border)",borderRadius:8},children:e.jsx("p",{style:{fontSize:13,color:"var(--color-text-primary)"},children:"This is the actual content that shows when not loading and not empty."})})}};var s,i,d;t.parameters={...t.parameters,docs:{...(s=t.parameters)==null?void 0:s.docs,source:{originalSource:`{
  args: {
    loading: true,
    empty: false,
    children: <div>Content</div>
  }
}`,...(d=(i=t.parameters)==null?void 0:i.docs)==null?void 0:d.source}}};var l,c,p;n.parameters={...n.parameters,docs:{...(l=n.parameters)==null?void 0:l.docs,source:{originalSource:`{
  args: {
    loading: true,
    empty: false,
    loadingText: "Fetching agents...",
    children: <div>Content</div>
  }
}`,...(p=(c=n.parameters)==null?void 0:c.docs)==null?void 0:p.source}}};var m,u,g;a.parameters={...a.parameters,docs:{...(m=a.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {
    loading: false,
    empty: true,
    emptyTitle: "No quests found",
    emptyDescription: "Create a quest to get started.",
    children: <div>Content</div>
  }
}`,...(g=(u=a.parameters)==null?void 0:u.docs)==null?void 0:g.source}}};var h,y,f;r.parameters={...r.parameters,docs:{...(h=r.parameters)==null?void 0:h.docs,source:{originalSource:`{
  args: {
    loading: false,
    empty: false,
    children: <div style={{
      padding: 16,
      border: "1px solid var(--color-border)",
      borderRadius: 8
    }}>
        <p style={{
        fontSize: 13,
        color: "var(--color-text-primary)"
      }}>
          This is the actual content that shows when not loading and not empty.
        </p>
      </div>
  }
}`,...(f=(y=r.parameters)==null?void 0:y.docs)==null?void 0:f.source}}};const R=["Loading","LoadingCustomText","Empty","WithContent"];export{a as Empty,t as Loading,n as LoadingCustomText,r as WithContent,R as __namedExportsOrder,D as default};
