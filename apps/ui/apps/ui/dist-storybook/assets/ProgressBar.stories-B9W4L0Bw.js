import{j as e}from"./jsx-runtime-D_zvdyIk.js";function c({value:a,max:n=100,label:m}){const B=n>0?Math.min(100,a/n*100):0;return e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"progress-bar-bg",role:"progressbar","aria-valuenow":a,"aria-valuemin":0,"aria-valuemax":n,children:e.jsx("div",{className:"progress-bar-fill",style:{width:`${B}%`}})}),m&&e.jsx("span",{className:"progress-text",children:m})]})}c.displayName="ProgressBar";c.__docgenInfo={description:"",methods:[],displayName:"ProgressBar",props:{value:{required:!0,tsType:{name:"number"},description:""},max:{required:!1,tsType:{name:"number"},description:"",defaultValue:{value:"100",computed:!1}},label:{required:!1,tsType:{name:"string"},description:""}}};const P={title:"UI/ProgressBar",component:c,tags:["autodocs"],decorators:[a=>e.jsx("div",{style:{width:300},children:e.jsx(a,{})})]},r={args:{value:0,label:"0%"}},s={args:{value:50,label:"50%"}},o={args:{value:100,label:"100%"}},l={args:{value:73,max:100,label:"73 of 100 tasks"}},t={args:{value:3,max:10,label:"3/10 complete"}};var u,p,i;r.parameters={...r.parameters,docs:{...(u=r.parameters)==null?void 0:u.docs,source:{originalSource:`{
  args: {
    value: 0,
    label: "0%"
  }
}`,...(i=(p=r.parameters)==null?void 0:p.docs)==null?void 0:i.source}}};var d,g,b;s.parameters={...s.parameters,docs:{...(d=s.parameters)==null?void 0:d.docs,source:{originalSource:`{
  args: {
    value: 50,
    label: "50%"
  }
}`,...(b=(g=s.parameters)==null?void 0:g.docs)==null?void 0:b.source}}};var v,x,f;o.parameters={...o.parameters,docs:{...(v=o.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    value: 100,
    label: "100%"
  }
}`,...(f=(x=o.parameters)==null?void 0:x.docs)==null?void 0:f.source}}};var h,y,j;l.parameters={...l.parameters,docs:{...(h=l.parameters)==null?void 0:h.docs,source:{originalSource:`{
  args: {
    value: 73,
    max: 100,
    label: "73 of 100 tasks"
  }
}`,...(j=(y=l.parameters)==null?void 0:y.docs)==null?void 0:j.source}}};var F,N,S;t.parameters={...t.parameters,docs:{...(F=t.parameters)==null?void 0:F.docs,source:{originalSource:`{
  args: {
    value: 3,
    max: 10,
    label: "3/10 complete"
  }
}`,...(S=(N=t.parameters)==null?void 0:N.docs)==null?void 0:S.source}}};const _=["Empty","HalfFull","Full","WithLabel","CustomMax"];export{t as CustomMax,r as Empty,o as Full,s as HalfFull,l as WithLabel,_ as __namedExportsOrder,P as default};
