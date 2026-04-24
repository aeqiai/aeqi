import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as l}from"./index-oxIuDU2I.js";import{P as oe}from"./Popover-Bw-spCWH.js";import{I as x}from"./IconButton-Xaaos3g3.js";import{B as le}from"./Button-DVRBRNVW.js";import"./_commonjsHelpers-CqkleIqs.js";const ae="_menu_1uvok_9",se="_item_1uvok_14",ie="_disabled_1uvok_33",ce="_destructive_1uvok_49",de="_armed_1uvok_60",ue="_icon_1uvok_67",me="_label_1uvok_84",s={menu:ae,item:se,disabled:ie,destructive:ce,armed:de,icon:ue,label:me};function a({trigger:Q,items:d,placement:X="bottom-end"}){const[u,I]=l.useState(!1),[i,f]=l.useState(null),[c,m]=l.useState(-1),Y=l.useId(),j=l.useRef([]),p=l.useCallback(()=>{I(!1),f(null),m(-1)},[]);l.useEffect(()=>{u||(f(null),m(-1))},[u]),l.useEffect(()=>{var t;c>=0&&u&&((t=j.current[c])==null||t.focus())},[c,u]);const Z=l.useCallback(t=>{const n=d.map((r,o)=>r.disabled?-1:o).filter(r=>r>=0);if(t.key==="ArrowDown"){t.preventDefault();const r=n.indexOf(c),o=n[(r+1)%n.length]??n[0];o!==void 0&&m(o)}else if(t.key==="ArrowUp"){t.preventDefault();const r=n.indexOf(c),o=n[(r-1+n.length)%n.length]??n[n.length-1];o!==void 0&&m(o)}else t.key==="Escape"&&(t.preventDefault(),p())},[d,c,p]),$=l.useCallback(t=>{t.disabled||(t.confirmLabel?i===t.key?(t.onSelect(),p()):f(t.key):(t.onSelect(),p()))},[i,p]),ee=l.useCallback(t=>{if(i===null)return;const n=t.target,r=j.current[d.findIndex(o=>o.key===i)];r&&!r.contains(n)&&f(null)},[i,d]),te=e.jsx("div",{id:Y,role:"menu","aria-label":"Actions",className:s.menu,onKeyDown:Z,onMouseDown:ee,children:d.map((t,n)=>{const r=i===t.key,o=r&&t.confirmLabel?t.confirmLabel:t.label,ne=[s.item,t.destructive?s.destructive:"",t.disabled?s.disabled:"",r?s.armed:""].filter(Boolean).join(" ");return e.jsxs("button",{ref:re=>{j.current[n]=re},role:"menuitem",type:"button",className:ne,disabled:t.disabled,"aria-disabled":t.disabled,tabIndex:t.disabled?-1:0,onClick:()=>$(t),onMouseEnter:()=>!t.disabled&&m(n),children:[t.icon&&e.jsx("span",{className:s.icon,"aria-hidden":!0,children:t.icon}),e.jsx("span",{className:s.label,children:o})]},t.key)})});return e.jsx(oe,{trigger:Q,open:u,onOpenChange:I,placement:X,children:te})}a.displayName="Menu";a.__docgenInfo={description:"",methods:[],displayName:"Menu",props:{trigger:{required:!0,tsType:{name:"ReactNode"},description:""},items:{required:!0,tsType:{name:"Array",elements:[{name:"MenuItem"}],raw:"MenuItem[]"},description:""},placement:{required:!1,tsType:{name:"union",raw:'"bottom-start" | "bottom-end"',elements:[{name:"literal",value:'"bottom-start"'},{name:"literal",value:'"bottom-end"'}]},description:"",defaultValue:{value:'"bottom-end"',computed:!1}}}};const k=()=>e.jsxs("svg",{width:"16",height:"16",viewBox:"0 0 16 16",fill:"currentColor","aria-hidden":!0,children:[e.jsx("circle",{cx:"3",cy:"8",r:"1.4"}),e.jsx("circle",{cx:"8",cy:"8",r:"1.4"}),e.jsx("circle",{cx:"13",cy:"8",r:"1.4"})]}),pe=()=>e.jsx("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5","aria-hidden":!0,children:e.jsx("path",{d:"M11 2l3 3-9 9H2v-3l9-9z"})}),be=()=>e.jsx("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5","aria-hidden":!0,children:e.jsx("path",{d:"M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"})}),ke={title:"Primitives/Actions/Menu",component:a,tags:["autodocs"],parameters:{layout:"centered"}},b={render:()=>e.jsx("div",{style:{padding:40},children:e.jsx(a,{trigger:e.jsx(x,{"aria-label":"More actions",children:e.jsx(k,{})}),items:[{key:"view",label:"View",onSelect:()=>alert("View")},{key:"edit",label:"Edit",onSelect:()=>alert("Edit")},{key:"duplicate",label:"Duplicate",onSelect:()=>alert("Duplicate")}],placement:"bottom-end"})})},v={render:()=>e.jsx("div",{style:{padding:40},children:e.jsx(a,{trigger:e.jsx(x,{"aria-label":"More actions",children:e.jsx(k,{})}),items:[{key:"edit",label:"Edit",icon:e.jsx(pe,{}),onSelect:()=>alert("Edit")},{key:"delete",label:"Delete",icon:e.jsx(be,{}),destructive:!0,onSelect:()=>alert("Delete")}],placement:"bottom-end"})})},y={render:()=>e.jsx("div",{style:{padding:40},children:e.jsx(a,{trigger:e.jsx(x,{"aria-label":"More actions",children:e.jsx(k,{})}),items:[{key:"edit",label:"Edit",onSelect:()=>alert("Edit")},{key:"delete",label:"Delete",destructive:!0,confirmLabel:"Confirm delete?",onSelect:()=>alert("Deleted!")}],placement:"bottom-end"})})},h={render:()=>e.jsx("div",{style:{padding:40},children:e.jsx(a,{trigger:e.jsx(x,{"aria-label":"More actions",children:e.jsx(k,{})}),items:[{key:"edit",label:"Edit",disabled:!0,onSelect:()=>{}},{key:"delete",label:"Delete",disabled:!0,destructive:!0,onSelect:()=>{}}],placement:"bottom-end"})})},g={render:()=>e.jsx("div",{style:{padding:40},children:e.jsx(a,{trigger:e.jsx(le,{variant:"secondary",children:"Actions ▾"}),items:[{key:"export",label:"Export",onSelect:()=>alert("Export")},{key:"archive",label:"Archive",onSelect:()=>alert("Archive")},{key:"delete",label:"Delete",destructive:!0,confirmLabel:"Really delete?",onSelect:()=>alert("Deleted")}],placement:"bottom-start"})})};var S,D,M,E,_;b.parameters={...b.parameters,docs:{...(S=b.parameters)==null?void 0:S.docs,source:{originalSource:`{
  render: () => <div style={{
    padding: 40
  }}>
      <Menu trigger={<IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>} items={[{
      key: "view",
      label: "View",
      onSelect: () => alert("View")
    }, {
      key: "edit",
      label: "Edit",
      onSelect: () => alert("Edit")
    }, {
      key: "duplicate",
      label: "Duplicate",
      onSelect: () => alert("Duplicate")
    }]} placement="bottom-end" />
    </div>
}`,...(M=(D=b.parameters)==null?void 0:D.docs)==null?void 0:M.source},description:{story:"Basic action list, no icons.",...(_=(E=b.parameters)==null?void 0:E.docs)==null?void 0:_.description}}};var w,B,C,A,K;v.parameters={...v.parameters,docs:{...(w=v.parameters)==null?void 0:w.docs,source:{originalSource:`{
  render: () => <div style={{
    padding: 40
  }}>
      <Menu trigger={<IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>} items={[{
      key: "edit",
      label: "Edit",
      icon: <EditIcon />,
      onSelect: () => alert("Edit")
    }, {
      key: "delete",
      label: "Delete",
      icon: <TrashIcon />,
      destructive: true,
      onSelect: () => alert("Delete")
    }]} placement="bottom-end" />
    </div>
}`,...(C=(B=v.parameters)==null?void 0:B.docs)==null?void 0:C.source},description:{story:"Items with leading icons.",...(K=(A=v.parameters)==null?void 0:A.docs)==null?void 0:K.description}}};var L,N,T,R,V;y.parameters={...y.parameters,docs:{...(L=y.parameters)==null?void 0:L.docs,source:{originalSource:`{
  render: () => <div style={{
    padding: 40
  }}>
      <Menu trigger={<IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>} items={[{
      key: "edit",
      label: "Edit",
      onSelect: () => alert("Edit")
    }, {
      key: "delete",
      label: "Delete",
      destructive: true,
      confirmLabel: "Confirm delete?",
      onSelect: () => alert("Deleted!")
    }]} placement="bottom-end" />
    </div>
}`,...(T=(N=y.parameters)==null?void 0:N.docs)==null?void 0:T.source},description:{story:"Destructive item with two-step confirm guard.",...(V=(R=y.parameters)==null?void 0:R.docs)==null?void 0:V.description}}};var W,O,q,P,z;h.parameters={...h.parameters,docs:{...(W=h.parameters)==null?void 0:W.docs,source:{originalSource:`{
  render: () => <div style={{
    padding: 40
  }}>
      <Menu trigger={<IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>} items={[{
      key: "edit",
      label: "Edit",
      disabled: true,
      onSelect: () => {}
    }, {
      key: "delete",
      label: "Delete",
      disabled: true,
      destructive: true,
      onSelect: () => {}
    }]} placement="bottom-end" />
    </div>
}`,...(q=(O=h.parameters)==null?void 0:O.docs)==null?void 0:q.source},description:{story:"All items disabled.",...(z=(P=h.parameters)==null?void 0:P.docs)==null?void 0:z.description}}};var H,U,F,G,J;g.parameters={...g.parameters,docs:{...(H=g.parameters)==null?void 0:H.docs,source:{originalSource:`{
  render: () => <div style={{
    padding: 40
  }}>
      <Menu trigger={<Button variant="secondary">Actions ▾</Button>} items={[{
      key: "export",
      label: "Export",
      onSelect: () => alert("Export")
    }, {
      key: "archive",
      label: "Archive",
      onSelect: () => alert("Archive")
    }, {
      key: "delete",
      label: "Delete",
      destructive: true,
      confirmLabel: "Really delete?",
      onSelect: () => alert("Deleted")
    }]} placement="bottom-start" />
    </div>
}`,...(F=(U=g.parameters)==null?void 0:U.docs)==null?void 0:F.source},description:{story:"Custom trigger — plain Button instead of IconButton.",...(J=(G=g.parameters)==null?void 0:G.docs)==null?void 0:J.description}}};const je=["Basic","WithIcons","DestructiveWithConfirm","AllDisabled","CustomTrigger"];export{h as AllDisabled,b as Basic,g as CustomTrigger,y as DestructiveWithConfirm,v as WithIcons,je as __namedExportsOrder,ke as default};
