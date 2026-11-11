import './NodeNetworkPanel.css';

// Presentation adapted from the original ControlPanelV18 AppShell/Card/MetricCard.
// It owns no node operations, routing, credentials, or telemetry sources.
export const NODE_NETWORK_SECTIONS = [
  {id:'overview',label:'Overview',icon:'home',title:'Operations Overview'},
  {id:'operations',label:'Operations',icon:'terminal',title:'Node Controls'},
  {id:'performance',label:'Performance',icon:'chart',title:'Performance'},
  {id:'monitoring',label:'Monitoring',icon:'activity',title:'Monitoring'},
  {id:'logs',label:'Logs',icon:'file',title:'Logs & Diagnostics'},
  {id:'settings',label:'Settings',icon:'settings',title:'Node Settings'},
];

function PanelIcon({name='activity',size=22}) {
 const paths={
  home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></>,
  terminal:<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 8 4 4-4 4m6 0h4"/></>,
  chart:<><path d="M3 3v18h18M8 16v-5m5 5V7m5 9V4"/></>,
  activity:<path d="M2 12h4l3-9 6 18 3-9h4"/>,
  file:<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h8"/></>,
  settings:<><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 2h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-2Z"/><circle cx="12" cy="11" r="3"/></>,
  refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></>,
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.activity}</svg>;
}

export function NodeNetworkPanelCard({title,icon,action,className='',children}) {
 return <section className={`v18-card ${className}`}>
  {(title||icon||action)&&<div className="v18-card__head"><div>{icon&&<span className="v18-icon-bubble">{icon}</span>}{title&&<h2>{title}</h2>}</div>{action}</div>}
  {children}
 </section>;
}

export function NodeNetworkPanelMetric({label,value,detail,tone='gray',icon,progress}) {
 const percentage=typeof progress==='number'&&Number.isFinite(progress)?Math.max(0,Math.min(100,progress)):null;
 return <section className={`v18-metric-card tone-${tone}`}>
  {icon||<PanelIcon/>}<div><span>{label}</span><strong>{value??'Not reported'}</strong>{detail&&<small>{detail}</small>}
   {percentage!==null&&<progress className="nn-panel-progress" max="100" value={percentage} aria-label={label}/>}</div>
 </section>;
}

export function NodeNetworkPanelStatusStrip({items=[],onRefresh,refreshing=false}) {
 if(!items.length&&!onRefresh)return null;
 return <section className="v18-overview-status-strip" aria-label="Selected node status">
  {items.map(({label,value,title},index)=><div key={`${label}:${index}`}><span>{label}</span><strong title={title}>{value??'Not reported'}</strong></div>)}
  {onRefresh&&<button type="button" className="v18-icon-button" aria-label="Refresh node status" title="Refresh node status" disabled={refreshing} onClick={onRefresh}><PanelIcon name="refresh" size={16}/></button>}
 </section>;
}

export function NodeNetworkPanelTrendGrid({children,label='Live metric trends'}) {
 return <section className="v18-overview-trend-grid" aria-label={label}>{children}</section>;
}

export function NodeNetworkPanelFrame({section='overview',onSectionChange,title,subtitle,statusLabel='Not inspected',statusTone='gray',onRefresh,refreshing=false,logoSrc='/assets/nodenetwork.png',nodeLabel,version,footerNote='Enrollment requires verified policy and host authorization',headerActions,statusItems=[],metrics=[],children}) {
 const active=NODE_NETWORK_SECTIONS.find(item=>item.id===section)||NODE_NETWORK_SECTIONS[0];
 const tone=['green','blue','purple','yellow','red','gray'].includes(statusTone)?statusTone:'gray';
 return <div className="nodenetwork-panel" aria-label="NodeNetwork operator workspace">
  <aside className="v18-sidebar">
   <div className="v18-sidebar-brand"><img className="v18-brand-banner" src={logoSrc} alt=""/><strong className="nn-panel-brand-name">NodeNetwork</strong>{nodeLabel&&<small className="nn-panel-node-label">{nodeLabel}</small>}</div>
   <nav className="v18-nav" aria-label="NodeNetwork sections">
    {NODE_NETWORK_SECTIONS.map(item=><button key={item.id} type="button" className={`v18-nav-link${active.id===item.id?' is-active':''}`} aria-current={active.id===item.id?'page':undefined} onClick={()=>onSectionChange?.(item.id)}><PanelIcon name={item.icon}/><span>{item.label}</span></button>)}
   </nav>
  </aside>
  <div className="v18-main">
   <div className="v18-top-controls"><button type="button" className={`v18-health-select is-${tone}`} disabled={!onRefresh||refreshing} onClick={onRefresh}><span className="v18-dot"/>{statusLabel}</button>{headerActions}</div>
   <div className="v18-content">
    <header className="v18-page-header"><div><h1>{title||active.title}</h1>{subtitle&&<p>{subtitle}</p>}</div></header>
    <NodeNetworkPanelStatusStrip items={statusItems}/>
    {!!metrics.length&&<div className="v18-overview-metric-grid">{metrics.map(metric=><NodeNetworkPanelMetric key={metric.label} {...metric}/>)}</div>}
    <div className="nn-panel-body">{children}</div>
   </div>
  </div>
  <footer className="v18-bottom-bar"><span className="v18-footer-copy">© {new Date().getFullYear()} Synergy Network. All rights reserved.</span><span className="v18-footer-status">{version?<span>Release {version}</span>:<span>Release not inspected</span>}</span><span className="nn-panel-footer-note">{footerNote}</span></footer>
 </div>;
}
