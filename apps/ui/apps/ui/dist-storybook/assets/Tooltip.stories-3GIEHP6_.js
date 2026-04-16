import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as m}from"./index-JhL3uwfD.js";import{B as i}from"./Button-CROBZTQq.js";const R="_wrapper_fonpr_1",N="_bubble_fonpr_6",S="_visible_fonpr_22",E="_top_fonpr_28",q="_bottom_fonpr_34",I="_left_fonpr_40",L="_right_fonpr_46",o={wrapper:R,bubble:N,visible:S,top:E,bottom:q,left:I,right:L};function l({content:c,position:w="top",children:H}){const[p,t]=m.useState(!1),d=m.useId();return e.jsxs("span",{className:o.wrapper,onMouseEnter:()=>t(!0),onMouseLeave:()=>t(!1),onFocus:()=>t(!0),onBlur:()=>t(!1),children:[e.jsx("span",{"aria-describedby":p?d:void 0,children:H}),e.jsx("span",{id:d,role:"tooltip",className:[o.bubble,o[w],p?o.visible:""].filter(Boolean).join(" "),children:c})]})}l.displayName="Tooltip";l.__docgenInfo={description:"",methods:[],displayName:"Tooltip",props:{content:{required:!0,tsType:{name:"string"},description:""},position:{required:!1,tsType:{name:"union",raw:'"top" | "bottom" | "left" | "right"',elements:[{name:"literal",value:'"top"'},{name:"literal",value:'"bottom"'},{name:"literal",value:'"left"'},{name:"literal",value:'"right"'}]},description:"",defaultValue:{value:'"top"',computed:!1}},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};const O={title:"UI/Tooltip",component:l,tags:["autodocs"],parameters:{layout:"centered"},decorators:[c=>e.jsx("div",{style:{padding:80},children:e.jsx(c,{})})]},r={args:{content:"This is a tooltip",position:"top",children:e.jsx(i,{variant:"secondary",children:"Hover me"})}},n={args:{content:"Below the element",position:"bottom",children:e.jsx(i,{variant:"secondary",children:"Hover me"})}},s={args:{content:"To the left",position:"left",children:e.jsx(i,{variant:"secondary",children:"Hover me"})}},a={args:{content:"To the right",position:"right",children:e.jsx(i,{variant:"secondary",children:"Hover me"})}};var u,h,f;r.parameters={...r.parameters,docs:{...(u=r.parameters)==null?void 0:u.docs,source:{originalSource:`{
  args: {
    content: "This is a tooltip",
    position: "top",
    children: <Button variant="secondary">Hover me</Button>
  }
}`,...(f=(h=r.parameters)==null?void 0:h.docs)==null?void 0:f.source}}};var v,b,g;n.parameters={...n.parameters,docs:{...(v=n.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    content: "Below the element",
    position: "bottom",
    children: <Button variant="secondary">Hover me</Button>
  }
}`,...(g=(b=n.parameters)==null?void 0:b.docs)==null?void 0:g.source}}};var _,y,B;s.parameters={...s.parameters,docs:{...(_=s.parameters)==null?void 0:_.docs,source:{originalSource:`{
  args: {
    content: "To the left",
    position: "left",
    children: <Button variant="secondary">Hover me</Button>
  }
}`,...(B=(y=s.parameters)==null?void 0:y.docs)==null?void 0:B.source}}};var T,x,j;a.parameters={...a.parameters,docs:{...(T=a.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    content: "To the right",
    position: "right",
    children: <Button variant="secondary">Hover me</Button>
  }
}`,...(j=(x=a.parameters)==null?void 0:x.docs)==null?void 0:j.source}}};const U=["Top","Bottom","Left","Right"];export{n as Bottom,s as Left,a as Right,r as Top,U as __namedExportsOrder,O as default};
