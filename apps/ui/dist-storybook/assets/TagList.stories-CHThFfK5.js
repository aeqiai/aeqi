import{j as n}from"./jsx-runtime-D_zvdyIk.js";function o({items:a,empty:i}){return!a||a.length===0?i?n.jsx("span",{className:"text-hint",children:i}):null:n.jsx("div",{className:"flex-wrap-tags",children:a.map(c=>n.jsx("span",{className:"expertise-tag",children:c},c))})}o.displayName="TagList";o.__docgenInfo={description:"",methods:[],displayName:"TagList",props:{items:{required:!0,tsType:{name:"Array",elements:[{name:"string"}],raw:"string[]"},description:""},empty:{required:!1,tsType:{name:"string"},description:""}}};const I={title:"UI/TagList",component:o,tags:["autodocs"]},e={args:{items:["typescript","react","devops","kubernetes","security"]}},s={args:{items:[]}},r={args:{items:[],empty:"No tags assigned"}},t={args:{items:["frontend"]}};var m,p,d;e.parameters={...e.parameters,docs:{...(m=e.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {
    items: ["typescript", "react", "devops", "kubernetes", "security"]
  }
}`,...(d=(p=e.parameters)==null?void 0:p.docs)==null?void 0:d.source}}};var g,u,l;s.parameters={...s.parameters,docs:{...(g=s.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    items: []
  }
}`,...(l=(u=s.parameters)==null?void 0:u.docs)==null?void 0:l.source}}};var y,x,h;r.parameters={...r.parameters,docs:{...(y=r.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    items: [],
    empty: "No tags assigned"
  }
}`,...(h=(x=r.parameters)==null?void 0:x.docs)==null?void 0:h.source}}};var f,T,N;t.parameters={...t.parameters,docs:{...(f=t.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    items: ["frontend"]
  }
}`,...(N=(T=t.parameters)==null?void 0:T.docs)==null?void 0:N.source}}};const S=["WithItems","Empty","EmptyWithText","SingleItem"];export{s as Empty,r as EmptyWithText,t as SingleItem,e as WithItems,S as __namedExportsOrder,I as default};
